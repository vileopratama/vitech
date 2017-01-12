from openerp.osv import fields, osv
from openerp import SUPERUSER_ID
from openerp.exceptions import UserError
from functools import partial
import time
from openerp import api, fields as Fields

class lounge_config(osv.osv):
    _name = 'lounge.config'
    LOUNGE_CONFIG_STATE = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('deprecated', 'Deprecated')
    ]

    def _get_current_session(self, cr, uid, ids, fieldnames, args, context=None):
        result = dict()
        for record in self.browse(cr, uid, ids, context=context):
            session_id = record.session_ids.filtered(lambda r: r.user_id.id == uid and not r.state == 'closed' and not r.rescue)
            result[record.id] = {
                'current_session_id': session_id,
                'current_session_state': session_id.state,
            }
        return result

    def _get_current_session_user(self, cr, uid, ids, fieldnames, args, context=None):
        result = dict()
        for record in self.browse(cr, uid, ids, context=context):
            result[record.id] = record.session_ids.filtered(lambda r: r.state == 'opened' and not r.rescue).user_id.name
        return result

    def _default_sale_journal(self, cr, uid, context=None):
        company_id = self.pool.get('res.users').browse(cr, uid, uid, context=context).company_id.id
        res = self.pool.get('account.journal').search(cr, uid, [('type', '=', 'sale'), ('company_id', '=', company_id)],
                                                      limit=1, context=context)
        return res and res[0] or False

    _columns = {
        'name': fields.char('Lounge Name', select=1,required=True, help="An internal identification of the point of lounge"),
        'journal_ids': fields.many2many('account.journal', 'lounge_config_journal_rel',
                                        'lounge_config_id', 'journal_id', 'Available Payment Methods',
                                        domain="[('journal_user', '=', True ), ('type', 'in', ['bank', 'cash'])]", ),
        'lounge_session_username': fields.function(_get_current_session_user, type='char'),
        'session_ids': fields.one2many('lounge.session', 'config_id', 'Sessions'),
        'state': fields.selection(LOUNGE_CONFIG_STATE, 'Status', required=True, readonly=True, copy=False),
        'current_session_id': fields.function(_get_current_session, multi="session", type="many2one",
                                              relation="lounge.session", string="Current Session"),
        'cash_control': fields.boolean('Cash Control', help="Check the amount of the cashbox at opening and closing."),
        'company_id': fields.many2one('res.company', 'Company', required=True),
        'journal_id': fields.many2one('account.journal', 'Sale Journal',
                                      domain=[('type', '=', 'sale')],
                                      help="Accounting journal used to post sales entries."),
    }

    _defaults = {
        'state': LOUNGE_CONFIG_STATE[0][0],
        'journal_id': _default_sale_journal,
        # 'stock_location_id': _get_default_location,
    }

    # def _get_default_location(self, cr, uid, context=None):
    #    wh_obj = self.pool.get('stock.warehouse')
    #    user = self.pool.get('res.users').browse(cr, uid, uid, context)
     #   res = wh_obj.search(cr, uid, [('company_id', '=', user.company_id.id)], limit=1, context=context)
     #   if res and res[0]:
     #       return wh_obj.browse(cr, uid, res[0], context=context).lot_stock_id.id
     #   return Fals


    def open_session_cb(self, cr, uid, ids, context=None):
        assert len(ids) == 1, "you can open only one session at a time"

        proxy = self.pool.get('lounge.session')
        record = self.browse(cr, uid, ids[0], context=context)
        current_session_id = record.current_session_id
        if not current_session_id:
            values = {
                'user_id': uid,
                'config_id': record.id,
            }
            session_id = proxy.create(cr, uid, values, context=context)
            self.write(cr, SUPERUSER_ID, record.id, {'current_session_id': session_id}, context=context)
            if record.current_session_id.state == 'opened':
                return self.open_ui(cr, uid, ids, context=context)
            return self._open_session(session_id)
        return self._open_session(current_session_id.id)

    def _open_session(self, session_id):
        return {
            'name': _('Session'),
            'view_type': 'form',
            'view_mode': 'form,tree',
            'res_model': 'lounge.session',
            'res_id': session_id,
            'view_id': False,
            'type': 'ir.actions.act_window',
        }

class lounge_session(osv.osv):
    _name = 'lounge.session'
    _order = 'id desc'
    LOUNGE_SESSION_STATE = [
        ('opening_control', 'Opening Control'),  # Signal open
        ('opened', 'In Progress'),  # Signal closing
        ('closing_control', 'Closing Control'),  # Signal close
        ('closed', 'Closed & Posted'),
    ]

    def _compute_cash_all(self, cr, uid, ids, fieldnames, args, context=None):
        result = dict()
        for record in self.browse(cr, uid, ids, context=context):
            result[record.id] = {
                'cash_journal_id' : False,
                'cash_register_id' : False,
                'cash_control' : False,
            }
            if record.config_id.cash_control:
                for st in record.statement_ids:
                    if st.journal_id.type == 'cash':
                        result[record.id]['cash_control'] = True
                        result[record.id]['cash_journal_id'] = st.journal_id.id
                        result[record.id]['cash_register_id'] = st.id

                if not result[record.id]['cash_control']:
                    raise UserError(_("Cash control can only be applied to cash journals."))

        return result

    _columns = {
        'config_id': fields.many2one('lounge.config', 'Lounge',
                                     help="The physical lounge you will use.",
                                     required=True, select=1, domain="[('state', '=', 'active')]", ),
        'name': fields.char('Session ID', required=True, readonly=True),
        'user_id': fields.many2one('res.users', 'Responsible',
                                   required=True,
                                   select=1,
                                   readonly=True,
                                   states={'opening_control': [('readonly', False)]}
                                   ),
        'state': fields.selection(LOUNGE_SESSION_STATE, 'Status',
                                  required=True, readonly=True,
                                  select=1, copy=False),
        'cash_control': fields.function(_compute_cash_all,
                                        multi='cash',
                                        type='boolean', string='Has Cash Control'),
        'currency_id': fields.related('config_id', 'currency_id', type="many2one", relation='res.currency',
                                      string="Currency"),
        'rescue': fields.boolean('Rescue session', readonly=True,
                                 help="Auto-generated session for orphan orders, ignored in constraints"),
        'start_at': fields.datetime('Opening Date',readonly=True),
        'stop_at': fields.datetime('Closing Date', readonly=True, copy=False),
        'sequence_number': fields.integer('Order Sequence Number',
                                          help='A sequence number that is incremented with each order'),
        'login_number': fields.integer('Login Sequence Number',
                                       help='A sequence number that is incremented each time a user resumes the pos session'),
        'journal_ids': fields.related('config_id', 'journal_ids',
                                      type='many2many',
                                      readonly=True,
                                      relation='account.journal',
                                      string='Available Payment Methods'),
        'statement_ids': fields.one2many('account.bank.statement', 'lounge_session_id', 'Bank Statement', readonly=True),
    }

    _defaults = {
        'name': '/',
        'user_id': lambda obj, cr, uid, context: uid,
        'state': 'opening_control',
        'sequence_number': 1,
        'login_number': 0,
    }

    _sql_constraints = [
        ('uniq_name', 'unique(name)', "Hallo Bro, The name of this POS Session must be unique !"),
    ]

    def _check_unicity(self, cr, uid, ids, context=None):
        for session in self.browse(cr, uid, ids, context=None):
            # open if there is no session in 'opening_control', 'opened', 'closing_control' for one user
            domain = [
                ('state', 'not in', ('closed','closing_control')),
                ('user_id', '=', session.user_id.id),
                ('rescue', '=', False)
            ]
            count = self.search_count(cr, uid, domain, context=context)
            if count>1:
                return False
        return True

    def _check_lounge_config(self, cr, uid, ids, context=None):
        for session in self.browse(cr, uid, ids, context=None):
            domain = [
                ('state', '!=', 'closed'),
                ('config_id', '=', session.config_id.id),
                ('rescue', '=', False)
            ]
            count = self.search_count(cr, uid, domain, context=context)
            if count>1:
                return False
        return True

    _constraints = [
        (_check_unicity, "You cannot create two active sessions with the same responsible!", ['user_id', 'state']),
        (_check_lounge_config, "You cannot create two active sessions related to the same point of sale!", ['config_id']),
    ]

    def create(self, cr, uid, values, context=None):
        context = dict(context or {})
        config_id = values.get('config_id', False) or context.get('default_config_id', False)
        if not config_id:
            raise UserError(_("You should assign a Point of Sale to your session."))

        # journal_id is not required on the pos_config because it does not
        # exists at the installation. If nothing is configured at the
        # installation we do the minimal configuration. Impossible to do in
        # the .xml files as the CoA is not yet installed.
        jobj = self.pool.get('lounge.config')
        lounge_config = jobj.browse(cr, uid, config_id, context=context)
        context.update({'company_id': lounge_config.company_id.id})
        #is_pos_user = self.pool['res.users'].has_group(cr, uid, 'point_of_sale.group_pos_user')
        if not lounge_config.journal_id:
            jid = jobj.default_get(cr, uid, ['journal_id'], context=context)['journal_id']
            if jid:
                jobj.write(cr, SUPERUSER_ID, [lounge_config.id], {'journal_id': jid}, context=context)
            else:
                raise UserError(_("Unable to open the session. You have to assign a sale journal to your lounge of sale."))

        # define some cash journal if no payment method exists
        if not lounge_config.journal_ids:
            journal_proxy = self.pool.get('account.journal')
            cashids = journal_proxy.search(cr, uid, [('journal_user', '=', True), ('type', '=', 'cash')],
                                                   context=context)
            if not cashids:
                cashids = journal_proxy.search(cr, uid, [('type', '=', 'cash')], context=context)
                if not cashids:
                    cashids = journal_proxy.search(cr, uid, [('journal_user', '=', True)], context=context)
                    journal_proxy.write(cr, SUPERUSER_ID, cashids, {'journal_user': True})
                    jobj.write(cr, SUPERUSER_ID, [lounge_config.id], {'journal_ids': [(6, 0, cashids)]})

        statements = []
        create_statement = partial(self.pool['account.bank.statement'].create, cr, SUPERUSER_ID or uid)
        for journal in lounge_config.journal_ids:
            #set the journal_id which should be used by
            #account.bank.statement to set the opening balance of the
            #newly created bank statement
            context['journal_id'] = journal.id if lounge_config.cash_control and journal.type == 'cash' else False
            st_values = {
                'journal_id': journal.id,
                'user_id': uid,
            }
            statements.append(create_statement(st_values, context=context))

        values.update({
            'name': self.pool['ir.sequence'].next_by_code(cr, uid, 'lounge.session', context=context),
            'statement_ids': [(6, 0, statements)],
            'config_id': config_id
        })

        return super(lounge_session, self).create(cr, SUPERUSER_ID or uid, values, context=context)