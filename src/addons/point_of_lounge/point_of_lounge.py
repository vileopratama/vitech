import openerp
from openerp.osv import fields, osv
from openerp import tools, SUPERUSER_ID
from openerp.exceptions import UserError
from functools import partial
import uuid
from openerp.tools.translate import _
import time
import logging

_logger = logging.getLogger(__name__)

class lounge_config(osv.osv):
    _name = 'lounge.config'
    LOUNGE_CONFIG_STATE = [
        ('active', 'Active'),
        ('inactive', 'Inactive'),
        ('deprecated', 'Deprecated')
    ]

    def _get_currency(self, cr, uid, ids, fieldnames, args, context=None):
        result = dict.fromkeys(ids, False)
        for lounge_config in self.browse(cr, uid, ids, context=context):
            if lounge_config.journal_id:
                currency_id = lounge_config.journal_id.currency_id.id or lounge_config.journal_id.company_id.currency_id.id
            else:
                currency_id = self.pool['res.users'].browse(cr, uid, uid, context=context).company_id.currency_id.id
            result[lounge_config.id] = currency_id
        return result

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

    def _default_pricelist(self, cr, uid, context=None):
        res = self.pool.get('product.pricelist').search(cr, uid, [], limit=1, context=context)
        return res and res[0] or False

    def _get_default_location(self, cr, uid, context=None):
        wh_obj = self.pool.get('stock.warehouse')
        user = self.pool.get('res.users').browse(cr, uid, uid, context)
        res = wh_obj.search(cr, uid, [('company_id', '=', user.company_id.id)], limit=1, context=context)
        if res and res[0]:
            return wh_obj.browse(cr, uid, res[0], context=context).lot_stock_id.id
        return False

    def _get_default_company(self, cr, uid, context=None):
        company_id = self.pool.get('res.users')._get_company(cr, uid, context=context)
        return company_id

    def _get_default_nomenclature(self, cr, uid, context=None):
        nom_obj = self.pool.get('barcode.nomenclature')
        res = nom_obj.search(cr, uid, [], limit=1, context=context)
        return res and res[0] or False

    def _check_company_location(self, cr, uid, ids, context=None):
        for config in self.browse(cr, uid, ids, context=context):
            if config.stock_location_id.company_id and config.stock_location_id.company_id.id != config.company_id.id:
                return False
        return True

    def _check_company_journal(self, cr, uid, ids, context=None):
        for config in self.browse(cr, uid, ids, context=context):
            if config.journal_id and config.journal_id.company_id.id != config.company_id.id:
                return False
        return True

    def _check_company_payment(self, cr, uid, ids, context=None):
        for config in self.browse(cr, uid, ids, context=context):
            journal_ids = [j.id for j in config.journal_ids]
            if self.pool['account.journal'].search(cr, uid, [
                ('id', 'in', journal_ids),
                ('company_id', '!=', config.company_id.id)
            ], count=True, context=context):
                return False
        return True

    _columns = {
        'name': fields.char('Lounge Name', select=1,required=True, help="An internal identification of the point of lounge"),
        'picking_type_id': fields.many2one('stock.picking.type', 'Picking Type'),
        'stock_location_id': fields.many2one('stock.location', 'Stock Location', domain=[('usage', '=', 'internal')],
                                             required=True),
        'company_id': fields.many2one('res.company', 'Company', required=True),
        'pricelist_id': fields.many2one('product.pricelist', 'Pricelist', required=True),
        'journal_id': fields.many2one('account.journal', 'Sale Journal',
                                      domain=[('type', '=', 'sale')],
                                      help="Accounting journal used to post sales entries."),
        'group_by': fields.boolean('Group Journal Items',
                                   help="Check this if you want to group the Journal Items by Product while closing a Session"),
        'barcode_nomenclature_id': fields.many2one('barcode.nomenclature', 'Barcodes',
                                                   help='Defines what kind of barcodes are available and how they are assigned to products, customers and cashiers',
                                                   required=True),
        'journal_ids': fields.many2many('account.journal', 'lounge_config_journal_rel',
                                        'lounge_config_id', 'journal_id', 'Available Payment Methods',
                                        domain="[('journal_user_lounge', '=', True ), ('type', 'in', ['bank', 'cash'])]", ),
        'sequence_id': fields.many2one('ir.sequence', 'Order IDs Sequence', readonly=True,
                                       help="This sequence is automatically created by Vitech but you can change it " \
                                            "to customize the reference numbers of your orders.", copy=False),
        'fiscal_position_ids': fields.many2many('account.fiscal.position', string='Fiscal Positions'),
        'currency_id': fields.function(_get_currency, type="many2one", string="Currency", relation="res.currency"),
        'lounge_session_username': fields.function(_get_current_session_user, type='char'),
        'session_ids': fields.one2many('lounge.session', 'config_id', 'Sessions'),
        'state': fields.selection(LOUNGE_CONFIG_STATE, 'Status', required=True, readonly=True, copy=False),
        'current_session_id': fields.function(_get_current_session, multi="session", type="many2one",
                                              relation="lounge.session", string="Current Session"),
        'iface_vkeyboard': fields.boolean('Virtual KeyBoard', help="Enables an integrated Virtual Keyboard"),
        'iface_invoicing': fields.boolean('Invoicing', help='Enables invoice generation from the Point of Sale'),
        'iface_precompute_cash': fields.boolean('Prefill Cash Payment',
                                                help='The payment input will behave similarily to bank payment input, and will be prefilled with the exact due amount'),
        'iface_start_categ_id': fields.many2one('lounge.category', 'Start Service Category',
                                                help='The point of sale will display this product category by default. If no category is specified, all available products will be shown'),
        'tip_product_id': fields.many2one('product.product', 'Tip Product',
                                          help="The product used to encode the customer tip. Leave empty if you do not accept tips."),
        'iface_tax_included': fields.boolean('Include Taxes in Prices',
                                             help='The displayed prices will always include all taxes, even if the taxes have been setup differently'),
        'iface_big_scrollbars': fields.boolean('Large Scrollbars', help='For imprecise industrial touchscreens'),
        'iface_print_auto': fields.boolean('Automatic Receipt Printing',
                                           help='The receipt will automatically be printed at the end of each order'),
        'iface_display_categ_images': fields.boolean('Display Category Pictures',
                                                     help="The product categories will be displayed with pictures."),
        'iface_print_skip_screen': fields.boolean('Skip Receipt Screen',
                                                  help='The receipt screen will be skipped if the receipt can be printed automatically.'),
        'cash_control': fields.boolean('Cash Control', help="Check the amount of the cashbox at opening and closing."),
        'proxy_ip': fields.char('IP Address',
                                help='The hostname or ip address of the hardware proxy, Will be autodetected if left empty',
                                size=45),
        'iface_print_via_proxy': fields.boolean('Print via Proxy',
                                                help="Bypass browser printing and prints via the hardware proxy"),
        'iface_scan_via_proxy': fields.boolean('Scan via Proxy',
                                               help="Enable barcode scanning with a remotely connected barcode scanner"),
        'iface_electronic_scale': fields.boolean('Electronic Scale', help="Enables Electronic Scale integration"),
        'iface_cashdrawer': fields.boolean('Cashdrawer', help="Automatically open the cashdrawer"),
        'receipt_header': fields.text('Receipt Header',
                                      help="A short text that will be inserted as a header in the printed receipt"),
        'receipt_footer': fields.text('Receipt Footer',
                                      help="A short text that will be inserted as a footer in the printed receipt"),
    }

    _constraints = [
        (_check_company_location, "The company of the stock location is different than the one of lounge",
         ['company_id', 'stock_location_id']),
        (_check_company_journal, "The company of the sale journal is different than the one of lounge",
         ['company_id', 'journal_id']),
        (_check_company_payment, "The company of a payment method is different than the one of lounge",
         ['company_id', 'journal_ids']),
    ]

    _defaults = {
        'uuid': lambda self, cr, uid, context={}: str(uuid.uuid4()),
        'state': LOUNGE_CONFIG_STATE[0][0],
        'journal_id': _default_sale_journal,
        'group_by': True,
        'iface_invoicing': True,
        'iface_print_auto': False,
        'iface_print_skip_screen': True,
        'pricelist_id': _default_pricelist,
        'stock_location_id': _get_default_location,
        'company_id': _get_default_company,
        'barcode_nomenclature_id': _get_default_nomenclature,
        #'group_pos_manager_id': _get_group_pos_manager,
        #'group_pos_user_id': _get_group_pos_user,
    }

    def set_active(self, cr, uid, ids, context=None):
        return self.write(cr, uid, ids, {'state' : 'active'}, context=context)

    def name_get(self, cr, uid, ids, context=None):
        result = []
        states = {
            'opening_control': _('Opening Control'),
            'opened': _('In Progress'),
            'closing_control': _('Closing Control'),
            'closed': _('Closed & Posted'),
        }
        for record in self.browse(cr, uid, ids, context=context):
            if (not record.session_ids) or (record.session_ids[0].state=='closed'):
                result.append((record.id, record.name+' ('+_('not used')+')'))
                continue
            session = record.session_ids[0]
            result.append((record.id, record.name + ' ('+session.user_id.name+')')) #, '+states[session.state]+')'))
        return result

    #@override on create
    def create(self, cr, uid, values, context=None):
        ir_sequence = self.pool.get('ir.sequence')
        values['sequence_id'] = ir_sequence.create(cr, SUPERUSER_ID, {
            'name': 'POS Order %s' % values['name'],
            'padding': 4,
            'prefix': "%s/" % values['name'],
            'code': "pos.order",
            'company_id': values.get('company_id', False),
        }, context=context)

        # TODO master: add field sequence_line_id on model
        # this make sure we always have one available per company
        ir_sequence.create(cr, SUPERUSER_ID, {
            'name': 'POS order line %s' % values['name'],
            'padding': 4,
            'prefix': "%s/" % values['name'],
            'code': "pos.order.line",
            'company_id': values.get('company_id', False),
        }, context=context)
        return super(lounge_config, self).create(cr, uid, values, context=context)

    #@override unlink / remove
    def unlink(self, cr, uid, ids, context=None):
        for obj in self.browse(cr, uid, ids, context=context):
            if obj.sequence_id:
                obj.sequence_id.unlink()
        return super(lounge_config, self).unlink(cr, uid, ids, context=context)

    """ Onchange Event """
    def onchange_picking_type_id(self, cr, uid, ids, picking_type_id, context=None):
        p_type_obj = self.pool.get("stock.picking.type")
        p_type = p_type_obj.browse(cr, uid, picking_type_id, context=context)
        if p_type.default_location_src_id and p_type.default_location_src_id.usage == 'internal' and p_type.default_location_dest_id and p_type.default_location_dest_id.usage == 'customer':
            return {'value': {'stock_location_id': p_type.default_location_src_id.id}}
        return False

    def onchange_iface_print_via_proxy(self, cr, uid, ids, print_via_proxy, context=None):
        return {'value': {'iface_print_auto': print_via_proxy}}

    """ Onchange Event """

#menu products
class product_template(osv.osv):
    _inherit = 'product.template'
    _columns = {
        'available_in_lounge': fields.boolean('Available in the Lounge',
                                           help='Check if you want this product to appear in the Lounge Session'),
        'lounge_to_weight': fields.boolean('To Weigh With Scale',
                                    help="Check if the product should be weighted using the hardware scale integration"),
        'lounge_categ_id': fields.many2one('lounge.category', 'Lounge Service Category',
                                        help="Those categories are used to group similar products for lounge."),
    }
    _defaults = {
        'lounge_to_weight': False,
        'available_in_lounge': True,
    }

    def unlink(self, cr, uid, ids, context=None):
        product_ctx = dict(context or {}, active_test=False)
        if self.search_count(cr, uid, [('id', 'in', ids), ('available_in_lounge', '=', True)], context=product_ctx):
            if self.pool['lounge.session'].search_count(cr, uid, [('state', '!=', 'closed')], context=context):
                raise UserError(
                    _('You cannot delete a product saleable in point of sale while a session is still opened.'))
        return super(product_template, self).unlink(cr, uid, ids, context=context)

#menu lounge session
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
        'cash_journal_id': fields.function(_compute_cash_all,
                                           multi='cash',
                                           type='many2one', relation='account.journal',
                                           string='Cash Journal', store=True),
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
        'cash_register_id': fields.function(_compute_cash_all,
                                            multi='cash',
                                            type='many2one', relation='account.bank.statement',
                                            string='Cash Register', store=True),
        'cash_register_balance_start': fields.related('cash_register_id', 'balance_start',
                                                      type='float',
                                                      digits=0,
                                                      string="Starting Balance",
                                                      help="Total of opening cash control lines.",
                                                      readonly=True),
        'cash_register_total_entry_encoding': fields.related('cash_register_id', 'total_entry_encoding',
                                                             string='Total Cash Transaction',
                                                             readonly=True,
                                                             help="Total of all paid sale orders"),
        'cash_register_balance_end': fields.related('cash_register_id', 'balance_end',
                                                    type='float',
                                                    digits=0,
                                                    string="Theoretical Closing Balance",
                                                    help="Sum of opening balance and transactions.",
                                                    readonly=True),
        'cash_register_difference': fields.related('cash_register_id', 'difference',
                                                   type='float',
                                                   string='Difference',
                                                   help="Difference between the theoretical closing balance and the real closing balance.",
                                                   readonly=True),
        'cash_register_balance_end_real': fields.related('cash_register_id', 'balance_end_real',
                                                         type='float',
                                                         digits=0,
                                                         string="Ending Balance",
                                                         help="Total of closing cash control lines.",
                                                         readonly=True),
        #'order_ids': fields.one2many('lounge.order', 'session_id', 'Orders'),
    }

    _defaults = {
        'name': '/',
        'user_id': lambda obj, cr, uid, context: uid,
        'state' : 'opening_control',
        'sequence_number': 1,
        'login_number': 0,
    }

    _sql_constraints = [
        ('uniq_name', 'unique(name)', "Hallo Bro, The name of this Lounge Session must be unique !"),
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
            raise UserError(_("You should assign a Lounge to your session."))

        # journal_id is not required on the pos_config because it does not
        # exists at the installation. If nothing is configured at the
        # installation we do the minimal configuration. Impossible to do in
        # the .xml files as the CoA is not yet installed.
        jobj = self.pool.get('lounge.config')
        lounge_config = jobj.browse(cr, uid, config_id, context=context)
        context.update({'company_id': lounge_config.company_id.id})
        # is_pos_user = self.pool['res.users'].has_group(cr, uid, 'point_of_sale.group_pos_user')
        if not lounge_config.journal_id:
            jid = jobj.default_get(cr, uid, ['journal_id'], context=context)['journal_id']
            if jid:
                 jobj.write(cr, SUPERUSER_ID, [lounge_config.id], {'journal_id': jid}, context=context)
            else:
                raise UserError(_("Unable to open the session. You have to assign a sale journal to your lounge."))

        # define some cash journal if no payment method exists
        if not lounge_config.journal_ids:
            journal_proxy = self.pool.get('account.journal')
            cashids = journal_proxy.search(cr, uid, [('journal_user_lounge', '=', True), ('type', '=', 'cash')],context=context)
            if not cashids:
                cashids = journal_proxy.search(cr, uid, [('type', '=', 'cash')], context=context)
                if not cashids:
                    cashids = journal_proxy.search(cr, uid, [('journal_user_lounge', '=', True)], context=context)

                journal_proxy.write(cr, SUPERUSER_ID, cashids, {'journal_user_lounge': True})
                jobj.write(cr, SUPERUSER_ID, [lounge_config.id], {'journal_ids': [(6, 0, cashids)]})

        statements = []
        create_statement = partial(self.pool['account.bank.statement'].create, cr,SUPERUSER_ID or uid)
        for journal in lounge_config.journal_ids:
            # set the journal_id which should be used by
            # account.bank.statement to set the opening balance of the
            # newly created bank statement
            context['journal_id'] = journal.id if lounge_config.cash_control and journal.type == 'cash' else False
            st_values = {
                'journal_id': journal.id,
                'user_id': uid,
            }
            statements.append(create_statement(st_values, context=context))

        values.update({
            #ir sequence(lounge.session) create a new session in setting => sequence (Developer Mode)
            'name': self.pool['ir.sequence'].next_by_code(cr, uid, 'lounge.session', context=context),
            'statement_ids': [(6, 0, statements)],
            'config_id': config_id,
            'start_at': time.strftime('%Y-%m-%d %H:%M:%S'),
            'state': 'opened',
        })
        return super(lounge_session, self).create(cr, SUPERUSER_ID or uid, values, context=context)

    #@override delete data
    def unlink(self, cr, uid, ids, context=None):
        for obj in self.browse(cr, uid, ids, context=context):
            self.pool.get('account.bank.statement').unlink(cr, uid, obj.statement_ids.ids, context=context)
        return super(lounge_session, self).unlink(cr, uid, ids, context=context)

    def login(self, cr, uid, ids, context=None):
        this_record = self.browse(cr, uid, ids[0], context=context)
        this_record.write({
            'login_number': this_record.login_number + 1,
        })

    #Workflow Action


#lounge category
class lounge_category(osv.osv):
    _name = "lounge.category"
    _description = "Public Service Category"
    _order = "sequence, name"

    _constraints = [
        (osv.osv._check_recursion, 'Error ! You cannot create recursive categories.', ['parent_id'])
    ]

    #@overide from function name
    def name_get(self, cr, uid, ids, context=None):
        res = []
        for cat in self.browse(cr, uid, ids, context=context):
            names = [cat.name]
            pcat = cat.parent_id
            while pcat:
                names.append(pcat.name)
                pcat = pcat.parent_id
            res.append((cat.id, ' / '.join(reversed(names))))
        return res

    def _name_get_fnc(self, cr, uid, ids, prop, unknow_none, context=None):
        res = self.name_get(cr, uid, ids, context=context)
        return dict(res)

    _columns = {
        'name': fields.char('Name', required=True, translate=True),
        'sequence': fields.integer('Sequence',
                                   help="Gives the sequence order when displaying a list of product categories."),
        'complete_name': fields.function(_name_get_fnc, type="char", string='Name'),
        'parent_id': fields.many2one('lounge.category', 'Parent Service', select=True),
        'child_id': fields.one2many('lounge.category', 'parent_id', string='Children Service'),
    }

    # NOTE: there is no 'default image', because by default we don't show
    # thumbnails for categories. However if we have a thumbnail for at least one
    # category, then we display a default image on the other, so that the
    # buttons have consistent styling.
    # In this case, the default image is set by the js code.
    image = openerp.fields.Binary("Image", attachment=True,
                                  help="This field holds the image used as image for the cateogry, limited to 1024x1024px.")
    image_medium = openerp.fields.Binary("Medium-sized image", attachment=True,
                                         help="Medium-sized image of the category. It is automatically " \
                                              "resized as a 128x128px image, with aspect ratio preserved. " \
                                              "Use this field in form views or some kanban views.")
    image_small = openerp.fields.Binary("Small-sized image", attachment=True,
                                        help="Small-sized image of the category. It is automatically " \
                                             "resized as a 64x64px image, with aspect ratio preserved. " \
                                             "Use this field anywhere a small image is required.")

    @openerp.api.model
    def create(self, vals):
        tools.image_resize_images(vals)
        return super(lounge_category, self).create(vals)

    @openerp.api.multi
    def write(self, vals):
        tools.image_resize_images(vals)
        return super(lounge_category, self).write(vals)


class lounge_order(osv.osv):
    _name = "lounge.order"
    _description = "Lounge"
    _order = "id desc"

    _columns = {
        'name': fields.char('Order Ref', required=True, readonly=True, copy=False),
    }
