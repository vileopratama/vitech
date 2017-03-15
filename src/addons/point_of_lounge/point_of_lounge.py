# -*- coding: utf-8 -*-
import logging
import psycopg2
import time
from datetime import datetime
import uuid
from functools import partial

import openerp
import openerp.addons.decimal_precision as dp
from openerp import tools, models, SUPERUSER_ID
from openerp.osv import fields, osv
from openerp.tools import float_is_zero
from openerp.tools.translate import _
from openerp.exceptions import UserError
from openerp import api, fields as Fields
from openerp.tools import DEFAULT_SERVER_DATETIME_FORMAT
import math
import pytz

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
            session_id = record.session_ids.filtered(
                lambda r: r.user_id.id == uid and not r.state == 'closed' and not r.rescue)
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

    def _get_last_session(self, cr, uid, ids, fieldnames, args, context=None):
        result = dict()

        for record in self.browse(cr, uid, ids, context=context):
            session_ids = self.pool['lounge.session'].search_read(cr, uid,
                                                                  [('config_id', '=', record.id),
                                                                   ('state', '=', 'closed')],
                                                                  ['cash_register_balance_end_real', 'stop_at'],
                                                                  order="stop_at desc", limit=1, context=context)
            if session_ids:
                result[record.id] = {
                    'last_session_closing_cash': session_ids[0]['cash_register_balance_end_real'],
                    'last_session_closing_date': session_ids[0]['stop_at'],
                }
            else:
                result[record.id] = {
                    'last_session_closing_cash': 0,
                    'last_session_closing_date': None,
                }
        return result

    def _get_group_lounge_manager(self, cr, uid, context=None):
        group = self.pool.get('ir.model.data').get_object_reference(cr, uid, 'point_of_lounge', 'group_lounge_manager')
        if group:
            return group[1]
        else:
            return False

    def _get_group_lounge_user(self, cr, uid, context=None):
        group = self.pool.get('ir.model.data').get_object_reference(cr, uid, 'point_of_lounge', 'group_lounge_user')
        if group:
            return group[1]
        else:
            return False

    _columns = {
        'name': fields.char('Lounge Name', select=1, required=True,
                            help="An internal identification of the point of lounge"),
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
        'iface_invoicing': fields.boolean('Invoicing', help='Enables invoice generation from the Lounge'),
        'iface_precompute_cash': fields.boolean('Prefill Cash Payment',
                                                help='The payment input will behave similarily to bank payment input, and will be prefilled with the exact due amount'),
        'iface_start_categ_id': fields.many2one('lounge.category', 'Start Service Category',
                                                help='The lounge will display this product category by default. If no category is specified, all available products will be shown'),
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
        'group_lounge_manager_id': fields.many2one('res.groups', 'Point of Lounge Manager Group',
                                                   help='This field is there to pass the id of the pos manager group to the point of sale client'),
        'group_lounge_user_id': fields.many2one('res.groups', 'Point of Lounge User Group',
                                                help='This field is there to pass the id of the pos user group to the point of sale client'),
        'last_session_closing_date': fields.function(_get_last_session, multi="last_session", type='date'),
        'last_session_closing_cash': fields.function(_get_last_session, multi="last_session", type='float'),
        'current_session_state': fields.function(_get_current_session, multi="session", type='char'),

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
        'group_lounge_manager_id': _get_group_lounge_manager,
        'group_lounge_user_id': _get_group_lounge_user,
    }

    def set_active(self, cr, uid, ids, context=None):
        return self.write(cr, uid, ids, {'state': 'active'}, context=context)

    def name_get(self, cr, uid, ids, context=None):
        result = []
        states = {
            'opening_control': _('Opening Control'),
            'opened': _('In Progress'),
            'closing_control': _('Closing Control'),
            'closed': _('Closed & Posted'),
        }
        for record in self.browse(cr, uid, ids, context=context):
            if (not record.session_ids) or (record.session_ids[0].state == 'closed'):
                result.append((record.id, record.name + ' (' + _('not used') + ')'))
                continue
            session = record.session_ids[0]
            result.append(
                (record.id, record.name + ' (' + session.user_id.name + ')'))  # , '+states[session.state]+')'))
        return result

    # @override on create
    def create(self, cr, uid, values, context=None):
        ir_sequence = self.pool.get('ir.sequence')
        values['sequence_id'] = ir_sequence.create(cr, SUPERUSER_ID, {
            'name': 'Lounge Order %s' % values['name'],
            'padding': 4,
            'prefix': "%s/" % values['name'],
            'code': "lounge.order",
            'company_id': values.get('company_id', False),
        }, context=context)

        # TODO master: add field sequence_line_id on model
        # this make sure we always have one available per company
        ir_sequence.create(cr, SUPERUSER_ID, {
            'name': 'Lounge order line %s' % values['name'],
            'padding': 4,
            'prefix': "%s/" % values['name'],
            'code': "lounge.order.line",
            'company_id': values.get('company_id', False),
        }, context=context)
        return super(lounge_config, self).create(cr, uid, values, context=context)

    # @override unlink / remove
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

    # Methods to open the POS
    def open_ui(self, cr, uid, ids, context=None):
        assert len(ids) == 1, "you can open only one session at a time"
        record = self.browse(cr, uid, ids[0], context=context)
        context = dict(context or {})
        context['active_id'] = record.current_session_id.id
        return {
            'type': 'ir.actions.act_url',
            'url': '/lounge/cashier/',
            'target': 'self',
        }

    def open_existing_session_cb_close(self, cr, uid, ids, context=None):
        assert len(ids) == 1, "you can open only one session at a time"
        record = self.browse(cr, uid, ids[0], context=context)
        record.current_session_id.signal_workflow('cashbox_control')
        return self.open_session_cb(cr, uid, ids, context)

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

    def open_existing_session_cb_close(self, cr, uid, ids, context=None):
        assert len(ids) == 1, "you can open only one session at a time"
        record = self.browse(cr, uid, ids[0], context=context)
        record.current_session_id.signal_workflow('cashbox_control')
        return self.open_session_cb(cr, uid, ids, context)

    def open_existing_session_cb(self, cr, uid, ids, context=None):
        assert len(ids) == 1, "you can open only one session at a time"
        record = self.browse(cr, uid, ids[0], context=context)
        return self._open_session(record.current_session_id.id)


# menu products
class product_template(osv.osv):
    _inherit = 'product.template'
    _columns = {
        'available_in_lounge': fields.boolean('Available in the Lounge',
                                              help='Check if you want this product to appear in the Lounge Session'),
        'lounge_to_weight': fields.boolean('To Weigh With Scale',
                                           help="Check if the product should be weighted using the hardware scale integration"),
        'lounge_categ_id': fields.many2one('lounge.category', 'Lounge Service Category',
                                           help="Those categories are used to group similar products for lounge."),
        'lounge_charge': fields.float('In Charge', digits=(16,0),
                                      help="Base in charge  compute the customer amount charge. Sometimes called the catalog price."),
        'discount_company' : fields.float('Disc (Company)',digits=(16,0)),
        'lounge_charge_every': fields.integer('In Charge Every',
                                              help="Base in charge every hour compute the customer amount charge. Sometimes called the catalog price."),
    }

    _defaults = {
        'lounge_to_weight': False,
        'available_in_lounge': True,
        'discount_company': 0,
    }

    def unlink(self, cr, uid, ids, context=None):
        product_ctx = dict(context or {}, active_test=False)
        if self.search_count(cr, uid, [('id', 'in', ids), ('available_in_lounge', '=', True)], context=product_ctx):
            if self.pool['lounge.session'].search_count(cr, uid, [('state', '!=', 'closed')], context=context):
                raise UserError(
                    _('You cannot delete a product saleable in lounge while a session is still opened.'))
        return super(product_template, self).unlink(cr, uid, ids, context=context)


class res_partner(osv.osv):
    _inherit = 'res.partner'

    def create_from_ui(self, cr, uid, partner, context=None):
        # image is a dataurl, get the data after the comma
        if partner.get('image', False):
            img = partner['image'].split(',')[1]
            partner['image'] = img

        if partner.get('id', False):  # Modifying existing partner
            partner_id = partner['id']
            del partner['id']
            self.write(cr, uid, [partner_id], partner, context=context)
        else:
            partner_id = self.create(cr, uid, partner, context=context)

        return partner_id


class barcode_rule(models.Model):
    _inherit = 'barcode.rule'

    def _get_type_selection(self):
        types = sets.Set(super(barcode_rule, self)._get_type_selection())
        types.update([
            ('weight', _('Weighted Product')),
            ('price', _('Priced Product')),
            ('discount', _('Discounted Product')),
            ('client', _('Client')),
            ('cashier', _('Cashier'))
        ])
        return list(types)


# menu lounge session
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
                'cash_journal_id': False,
                'cash_register_id': False,
                'cash_control': False,
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
        'start_at': fields.datetime('Opening Date', readonly=True),
        'stop_at': fields.datetime('Closing Date', readonly=True, copy=False),
        'sequence_number': fields.integer('Order Sequence Number',
                                          help='A sequence number that is incremented with each order'),
        'login_number': fields.integer('Login Sequence Number',
                                       help='A sequence number that is incremented each time a user resumes the lounge session'),
        'journal_ids': fields.related('config_id', 'journal_ids',
                                      type='many2many',
                                      readonly=True,
                                      relation='account.journal',
                                      string='Available Payment Methods'),
        'statement_ids': fields.one2many('account.bank.statement', 'lounge_session_id', 'Bank Statement',
                                         readonly=True),
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
                                                             help="Total of all paid of lounge"),
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
        'order_ids': fields.one2many('lounge.order', 'session_id', 'Orders'),
    }

    _defaults = {
        'name': '/',
        'user_id': lambda obj, cr, uid, context: uid,
        'state': 'opening_control',
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
                ('state', 'not in', ('closed', 'closing_control')),
                ('user_id', '=', session.user_id.id),
                ('rescue', '=', False)
            ]
            count = self.search_count(cr, uid, domain, context=context)
            if count > 1:
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
            if count > 1:
                return False
        return True

    _constraints = [
        (_check_unicity, "You cannot create two active sessions with the same responsible!", ['user_id', 'state']),
        (_check_lounge_config, "You cannot create two active sessions related to the same lounge!", ['config_id']),
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
        is_lounge_user = self.pool['res.users'].has_group(cr, uid, 'point_of_lounge.group_lounge_user')
        if not lounge_config.journal_id:
            jid = jobj.default_get(cr, uid, ['journal_id'], context=context)['journal_id']
            if jid:
                jobj.write(cr, SUPERUSER_ID, [lounge_config.id], {'journal_id': jid}, context=context)
            else:
                raise UserError(_("Unable to open the session. You have to assign a journal to your lounge."))

        # define some cash journal if no payment method exists
        if not lounge_config.journal_ids:
            journal_proxy = self.pool.get('account.journal')
            cashids = journal_proxy.search(cr, uid, [('journal_user_lounge', '=', True), ('type', '=', 'cash')],
                                           context=context)
            if not cashids:
                cashids = journal_proxy.search(cr, uid, [('type', '=', 'cash')], context=context)
                if not cashids:
                    cashids = journal_proxy.search(cr, uid, [('journal_user_lounge', '=', True)], context=context)

                journal_proxy.write(cr, SUPERUSER_ID, cashids, {'journal_user_lounge': True})
                jobj.write(cr, SUPERUSER_ID, [lounge_config.id], {'journal_ids': [(6, 0, cashids)]})

        statements = []
        create_statement = partial(self.pool['account.bank.statement'].create, cr,
                                   is_lounge_user and SUPERUSER_ID or uid)
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
            'name': self.pool['ir.sequence'].next_by_code(cr, uid, 'lounge.session', context=context),
            'statement_ids': [(6, 0, statements)],
            'config_id': config_id,
        })
        return super(lounge_session, self).create(cr, is_lounge_user and SUPERUSER_ID or uid, values, context=context)

    # @override delete data
    def unlink(self, cr, uid, ids, context=None):
        for obj in self.browse(cr, uid, ids, context=context):
            self.pool.get('account.bank.statement').unlink(cr, uid, obj.statement_ids.ids, context=context)
        return super(lounge_session, self).unlink(cr, uid, ids, context=context)

    def login(self, cr, uid, ids, context=None):
        this_record = self.browse(cr, uid, ids[0], context=context)
        this_record.write({
            'login_number': this_record.login_number + 1,
        })

    # Workflow Action
    def wkf_action_opening_control(self, cr, uid, ids, context=None):
        return self.write(cr, uid, ids, {'state': 'opening_control'}, context=context)

    def wkf_action_open(self, cr, uid, ids, context=None):
        # second browse because we need to refetch the data from the DB for cash_register_id
        for record in self.browse(cr, uid, ids, context=context):
            values = {}
            if not record.start_at:
                values['start_at'] = time.strftime('%Y-%m-%d %H:%M:%S')
            values['state'] = 'opened'
            record.write(values)
            for st in record.statement_ids:
                st.button_open()
        return True

    def wkf_action_closing_control(self, cr, uid, ids, context=None):
        for session in self.browse(cr, uid, ids, context=context):
            for statement in session.statement_ids:
                if (statement != session.cash_register_id) and (statement.balance_end != statement.balance_end_real):
                    self.pool.get('account.bank.statement').write(cr, uid, [statement.id],
                                                                  {'balance_end_real': statement.balance_end})
        return self.write(cr, uid, ids, {'state': 'closing_control', 'stop_at': time.strftime('%Y-%m-%d %H:%M:%S')},
                          context=context)

    def wkf_action_close(self, cr, uid, ids, context=None):
        # Close CashBox
        local_context = dict(context)
        for record in self.browse(cr, uid, ids, context=context):
            company_id = record.config_id.company_id.id
            local_context.update({'force_company': company_id, 'company_id': company_id})
            for st in record.statement_ids:
                if abs(st.difference) > st.journal_id.amount_authorized_diff_lounge:
                    # The lounge manager can close statements with maximums.
                    if not self.pool.get('ir.model.access').check_groups(cr, uid,
                                                                         "point_of_lounge.group_lounge_manager"):
                        raise UserError(_(
                            "Your ending balance is too different from the theoretical cash closing (%.2f), the maximum allowed is: %.2f. You can contact your manager to force it.") % (
                                        st.difference, st.journal_id.amount_authorized_diff_lounge))
                if (st.journal_id.type not in ['bank', 'cash']):
                    raise UserError(_("The type of the journal for your payment method should be bank or cash "))
                self.pool['account.bank.statement'].button_confirm_bank(cr, SUPERUSER_ID, [st.id],
                                                                        context=local_context)

        # function _confirm order
        self._confirm_orders(cr, uid, ids, context=local_context)
        # close status
        self.write(cr, uid, ids, {'state': 'closed'}, context=local_context)

        obj = self.pool.get('ir.model.data').get_object_reference(cr, uid, 'point_of_lounge', 'menu_lounge_root')[1]
        return {
            'type': 'ir.actions.client',
            'name': 'Point of Lounge Menu',
            'tag': 'reload',
            'params': {'menu_id': obj},
        }

    # function _confirm order reference to closed status
    def _confirm_orders(self, cr, uid, ids, context=None):
        lounge_order_obj = self.pool.get('lounge.order')
        for session in self.browse(cr, uid, ids, context=context):
            company_id = session.config_id.journal_id.company_id.id
            local_context = dict(context or {}, force_company=company_id)
            order_ids = [order.id for order in session.order_ids if order.state == 'paid']

            move_id = lounge_order_obj._create_account_move(cr, uid, session.start_at, session.name,
                                                            session.config_id.journal_id.id, company_id,
                                                            context=context)
            lounge_order_obj._create_account_move_line(cr, uid, order_ids, session, move_id, context=local_context)

            for order in session.order_ids:
                if order.state == 'done':
                    continue
                if order.state not in ('paid', 'invoiced'):
                    raise UserError(
                        _("You cannot confirm all orders of this session, because they have not the 'paid' status"))
                else:
                    lounge_order_obj.signal_workflow(cr, uid, [order.id], 'done')
        return True

    def open_frontend_cb(self, cr, uid, ids, context=None):
        if not context:
            context = {}
        if not ids:
            return {}
        for session in self.browse(cr, uid, ids, context=context):
            if session.user_id.id != uid:
                raise UserError(_(
                    "You cannot use the session of another users. This session is owned by %s. ""Please first close this one to use this lounge.") % session.user_id.name)
        context.update({'active_id': ids[0]})
        return {
            'type': 'ir.actions.act_url',
            'target': 'self',
            'url': '/lounge/cashier/',
        }


# lounge category
class lounge_category(osv.osv):
    _name = "lounge.category"
    _description = "Public Service Category"
    _order = "sequence, name"

    _constraints = [
        (osv.osv._check_recursion, 'Error ! You cannot create recursive categories.', ['parent_id'])
    ]

    # @overide from function name
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

    def _order_fields(self, cr, uid, ui_order, context=None):
        process_line = partial(self.pool['lounge.order.line']._order_line_fields, cr, uid, context=context)
        # get user's timezone
        # user_pool = self.pool.get('res.users')
        # user = user_pool.browse(cr, SUPERUSER_ID, uid)
        # tz = pytz.timezone(user.partner_id.tz) or pytz.utc

        return {
            'name': ui_order['name'],
            'flight_type': ui_order['flight_type'],
            'flight_number': ui_order['flight_number'],
            'booking_from_date': ui_order['booking_from_date'],
            'booking_to_date': ui_order['booking_to_date'],
            'booking_total': ui_order['booking_total'],
            'user_id': ui_order['user_id'] or False,
            'session_id': ui_order['lounge_session_id'],
            'lines': [process_line(l) for l in ui_order['lines']] if ui_order['lines'] else False,
            'lounge_reference': ui_order['name'],
            'partner_id': ui_order['partner_id'] or False,
            'date_order': ui_order['creation_date'],
            'fiscal_position_id': ui_order['fiscal_position_id'],
        }

    def _payment_fields(self, cr, uid, ui_paymentline, context=None):
        return {
            'amount': ui_paymentline['amount'] or 0.0,
            'payment_date': ui_paymentline['name'],
            'statement_id': ui_paymentline['statement_id'],
            'payment_name': ui_paymentline.get('note', False),
            'journal': ui_paymentline['journal_id'],
        }

    def _process_order(self, cr, uid, order, context=None):
        prec_acc = self.pool.get('decimal.precision').precision_get(cr, uid, 'Account')
        session = self.pool.get('lounge.session').browse(cr, uid, order['lounge_session_id'], context=context)

        if session.state == 'closing_control' or session.state == 'closed':
            session_id = self._get_valid_session(cr, uid, order, context=context)
            session = self.pool.get('lounge.session').browse(cr, uid, session_id, context=context)
            order['lounge_session_id'] = session_id

        order_id = self.create(cr, uid, self._order_fields(cr, uid, order, context=context), context)
        journal_ids = set()

        for payments in order['statement_ids']:
            if not float_is_zero(payments[2]['amount'], precision_digits=prec_acc):
                self.add_payment(cr, uid, order_id, self._payment_fields(cr, uid, payments[2], context=context),
                                 context=context)
            journal_ids.add(payments[2]['journal_id'])

        if session.sequence_number <= order['sequence_number']:
            session.write({'sequence_number': order['sequence_number'] + 1})
            session.refresh()

        if not float_is_zero(order['amount_return'], precision_digits=prec_acc):
            cash_journal = session.cash_journal_id.id
            if not cash_journal:
                # Select for change one of the cash journals used in this payment
                cash_journal_ids = self.pool['account.journal'].search(cr, uid, [
                    ('type', '=', 'cash'),
                    ('id', 'in', list(journal_ids)),
                ], limit=1, context=context)
                if not cash_journal_ids:
                    # If none, select for change one of the cash journals of the Lounge
                    # This is used for example when a customer pays by credit card
                    # an amount higher than total amount of the order and gets cash back
                    cash_journal_ids = [statement.journal_id.id for statement in session.statement_ids
                                        if statement.journal_id.type == 'cash']
                    if not cash_journal_ids:
                        raise UserError(
                            _("No cash statement found for this session. Unable to record returned cash."))
                cash_journal = cash_journal_ids[0]
            self.add_payment(cr, uid, order_id, {
                'amount': -order['amount_return'],
                'payment_date': time.strftime('%Y-%m-%d %H:%M:%S'),
                'payment_name': _('return'),
                'journal': cash_journal,
            }, context=context)

        return order_id

    def create_from_ui(self, cr, uid, orders, context=None):
        submitted_references = [o['data']['name'] for o in orders]
        existing_order_ids = self.search(cr, uid, [('lounge_reference', 'in', submitted_references)],
                                         context=context)
        existing_orders = self.read(cr, uid, existing_order_ids, ['lounge_reference'], context=context)
        existing_references = set([o['lounge_reference'] for o in existing_orders])
        orders_to_save = [o for o in orders if o['data']['name'] not in existing_references]
        order_ids = []

        for tmp_order in orders_to_save:
            to_invoice = tmp_order['to_invoice']
            order = tmp_order['data']

            if to_invoice:
                self._match_payment_to_invoice(cr, uid, order, context=context)

            order_id = self._process_order(cr, uid, order, context=context)
            order_ids.append(order_id)
            try:
                self.signal_workflow(cr, uid, [order_id], 'paid')
            except psycopg2.OperationalError:
                # do not hide transactional errors, the order(s) won't be saved!
                raise
            except Exception as e:
                _logger.error('Could not fully process the Lounge Order: %s', tools.ustr(e))

            if to_invoice:
                self.action_invoice(cr, uid, [order_id], context)
                order_obj = self.browse(cr, uid, order_id, context)
                self.pool['account.invoice'].signal_workflow(cr, SUPERUSER_ID, [order_obj.invoice_id.id],
                                                             'invoice_open')
        return order_ids

    def _checkout_order_fields(self, cr, uid, ui_order, context=None):
        process_line = partial(self.pool['lounge.order.line']._order_line_fields, cr, uid, context=context)
        # get user's timezone
        # user_pool = self.pool.get('res.users')
        # user = user_pool.browse(cr, SUPERUSER_ID, uid)
        # tz = pytz.timezone(user.partner_id.tz) or pytz.utc

        return {
            'name': ui_order['name'],
            'is_checkout' : False,
            'user_id': ui_order['user_id'] or False,
            'session_id': ui_order['lounge_session_id'],
            'lines': [process_line(l) for l in ui_order['lines']] if ui_order['lines'] else False,
            'lounge_reference': ui_order['name'],
            'partner_id': ui_order['partner_id'] or False,
            'date_order': ui_order['creation_date'],
            'fiscal_position_id': ui_order['fiscal_position_id'],
        }

    def _process_checkout_order(self, cr, uid, order, context=None):
        prec_acc = self.pool.get('decimal.precision').precision_get(cr, uid, 'Account')
        session = self.pool.get('lounge.session').browse(cr, uid, order['lounge_session_id'], context=context)

        if session.state == 'closing_control' or session.state == 'closed':
            session_id = self._get_valid_session(cr, uid, order, context=context)
            session = self.pool.get('lounge.session').browse(cr, uid, session_id, context=context)
            order['lounge_session_id'] = session_id

        order_id = self.create(cr, uid, self._checkout_order_fields(cr, uid, order, context=context), context)
        journal_ids = set()

        for payments in order['statement_ids']:
            if not float_is_zero(payments[2]['amount'], precision_digits=prec_acc):
                self.add_checkout_payment(cr, uid, order_id, self._payment_fields(cr, uid, payments[2], context=context),
                                 context=context)
            journal_ids.add(payments[2]['journal_id'])

        if session.sequence_number <= order['sequence_number']:
            session.write({'sequence_number': order['sequence_number'] + 1})
            session.refresh()

        if not float_is_zero(order['amount_return'], precision_digits=prec_acc):
            cash_journal = session.cash_journal_id.id
            if not cash_journal:
                cash_journal_ids = self.pool['account.journal'].search(cr, uid, [
                    ('type', '=', 'cash'),
                    ('id', 'in', list(journal_ids)),
                ], limit=1, context=context)

                if not cash_journal_ids:
                    cash_journal_ids = [statement.journal_id.id for statement in session.statement_ids
                                    if statement.journal_id.type == 'cash']

                    if not cash_journal_ids:
                        raise UserError(
                            _("No cash statement found for this session. Unable to record returned cash."))

                cash_journal = cash_journal_ids[0]

            self.add_payment(cr, uid, order_id, {
                'amount': -order['amount_return'],
                'payment_date': time.strftime('%Y-%m-%d %H:%M:%S'),
                'payment_name': _('return'),
                'journal': cash_journal,
            }, context=context)
        return order_id

    def update_from_ui(self, cr, uid, orders, context=None):
        submitted_references = [o['data']['name'] for o in orders]
        existing_order_ids = self.search(cr, uid, [('lounge_reference', 'in', submitted_references)],
                                         context=context)
        existing_orders = self.read(cr, uid, existing_order_ids, ['lounge_reference'], context=context)
        existing_references = set([o['lounge_reference'] for o in existing_orders])
        orders_to_save = [o for o in orders if o['data']['name'] not in existing_references]
        order_ids = []

        for tmp_order in orders_to_save:
            order = tmp_order['data']
            order_id = self._process_checkout_order(cr, uid, order, context=context)
            order_ids.append(order_id)

            try:
                self.signal_workflow(cr, uid, [order_id], 'paid')
            except psycopg2.OperationalError:
                # do not hide transactional errors, the order(s) won't be saved!
                raise
            except Exception as e:
                _logger.error('Could not fully process the Lounge Order: %s', tools.ustr(e))

            #if to_invoice:
            #    self.action_invoice(cr, uid, [order_id], context)
            #    order_obj = self.browse(cr, uid, order_id, context)
            #    self.pool['account.invoice'].signal_workflow(cr, SUPERUSER_ID, [order_obj.invoice_id.id],'invoice_open')
        return order_ids

    _columns = {
        'name': fields.char('Order Ref', required=True, readonly=True, copy=False),
        'date_order': fields.datetime('Order Date', readonly=False, select=True),
        'booking_from_date': fields.datetime('Booking From', readonly=False, select=True),
        'booking_to_date': fields.datetime('Booking To', readonly=False, select=True),
        'is_checkout': fields.boolean('Is Checkout',readonly=True),
        'flight_type': fields.selection([('domestic', 'Domestic'),
                                        ('international','International')],string='Flight Type',copy=False),
        'flight_number': fields.char('Flight No.', required=True,copy=False),
        'booking_total': fields.float(string="Total Hours"),
        'session_id': fields.many2one('lounge.session', 'Session',
                                      required=True,
                                      select=1,
                                      domain="[('state', '=', 'opened')]",
                                      states={'draft': [('readonly', False)]},
                                      readonly=True),
        'state': fields.selection([('draft', 'New'),
                                   ('cancel', 'Cancelled'),
                                   ('paid', 'Paid'),
                                   ('done', 'Posted'),
                                   ('invoiced', 'Invoiced')],
                                  'Status', readonly=True, copy=False),
        'partner_id': fields.many2one('res.partner', 'Customer', change_default=True, select=1,
                                      states={'draft': [('readonly', False)], 'paid': [('readonly', False)]}),
        'fiscal_position_id': fields.many2one('account.fiscal.position', 'Fiscal Position'),
        'lines': fields.one2many('lounge.order.line', 'order_id', 'Order Lines',
                                 states={'draft': [('readonly', False)]},
                                 readonly=True, copy=True),
        'pricelist_id': fields.many2one('product.pricelist', 'Pricelist', required=True,
                                        states={'draft': [('readonly', False)]}, readonly=True),
        'statement_ids': fields.one2many('account.bank.statement.line', 'lounge_statement_id', 'Payments',
                                         states={'draft': [('readonly', False)]}, readonly=True),
        'company_id': fields.many2one('res.company', 'Company', required=True, readonly=True),
        'location_id': fields.related('session_id', 'config_id', 'stock_location_id', string="Location",
                                      type='many2one', store=True, relation='stock.location'),
        'user_id': fields.many2one('res.users', 'Salesman'),
        'picking_id': fields.many2one('stock.picking', 'Picking', readonly=True, copy=False),
        'lounge_reference': fields.char('Receipt Ref', readonly=True, copy=False),
        'note': fields.text('Internal Notes'),
        'sale_journal': fields.related('session_id', 'config_id', 'journal_id', relation='account.journal',
                                       type='many2one', string='Sale Journal', store=True, readonly=True),
        'invoice_id': fields.many2one('account.invoice', 'Invoice', copy=False),
        'account_move': fields.many2one('account.move', 'Journal Entry', readonly=True, copy=False),
        'picking_type_id': fields.related('session_id', 'config_id', 'picking_type_id', string="Picking Type",
                                          type='many2one', relation='stock.picking.type'),
        'config_id': fields.related('session_id', 'config_id', string="Lounge", type='many2one',
                                    relation='lounge.config'),
        'service_01': fields.char(compute='_compute_amount_all',string='Service 1',size=100,store=True),
        'service_02': fields.char(compute='_compute_amount_all',string='Service 2', size=100,store=True),
        'service_03': fields.char(compute='_compute_amount_all',string='Service 3', size=100,store=True),
        'journal_id': fields.many2one('account.journal','Payment Method'),
        'total_pax': fields.integer(compute='_compute_amount_all',string='No.Pax',size=3,store=True),
        'company_type': fields.related('partner_id','company_type',string='Type',type='char',store=False),
    }

    """
       Function
       """

    def _amount_line_tax(self, cr, uid, line, fiscal_position_id, context=None):
        taxes = line.tax_ids.filtered(lambda t: t.company_id.id == line.order_id.company_id.id)
        if fiscal_position_id:
            taxes = fiscal_position_id.map_tax(taxes)
        price = line.price_unit * (1 - (line.discount or 0.0) / 100.0)
        price = price + line.charge
        cur = line.order_id.pricelist_id.currency_id
        taxes = \
        taxes.compute_all(price, cur, line.qty, product=line.product_id, partner=line.order_id.partner_id or False)[
            'taxes']
        val = 0.0
        for c in taxes:
            val += c.get('amount', 0.0)
        return val

    # summary
    amount_surcharge = Fields.Float(compute='_compute_amount_all', string='Surcharge', digits=0)
    amount_tax = Fields.Float(compute='_compute_amount_all', string='Taxes', digits=0)
    amount_total = Fields.Float(compute='_compute_amount_all', string='Total', digits=0)
    amount_paid = Fields.Float(compute='_compute_amount_all', string='Paid', states={'draft': [('readonly', False)]},
                               readonly=True, digits=0)
    amount_return = Fields.Float(compute='_compute_amount_all', string='Returned', digits=0)
    """
        Function
        """

    @api.depends('statement_ids', 'lines.price_subtotal_incl', 'lines.discount')
    def _compute_amount_all(self):
        for order in self:
            order.amount_paid = order.amount_return = order.amount_tax = 0.0
            currency = order.pricelist_id.currency_id
            order.amount_paid = sum(payment.amount for payment in order.statement_ids)
            order.amount_return = sum(payment.amount < 0 and payment.amount or 0 for payment in order.statement_ids)
            order.amount_surcharge = currency.round(sum(line.price_charge for line in order.lines))
            order.amount_tax = currency.round(
                sum(self._amount_line_tax(line, order.fiscal_position_id) for line in order.lines))
            amount_untaxed = currency.round(sum(line.price_subtotal for line in order.lines))
            order.amount_total = order.amount_tax + amount_untaxed

            i = 0
            qty = 0
            for sline in order.lines:
                i = i + 1
                qty = qty + sline.qty

                if i == 1:
                    order.service_01 = sline.product_id.name
                if i == 2:
                    order.service_02 = sline.product_id.name
                if i == 3:
                    order.service_03 = sline.product_id.name

            order.total_pax = int(math.ceil(qty / i))

    @api.onchange('booking_from_date')
    def _onchange_booking_from_date(self):
        booking_total = self._get_booking_total(self.booking_from_date, self.booking_to_date)
        return self.update({'booking_total': booking_total})

    @api.onchange('booking_to_date')
    def _onchange_booking_to_date(self):
        booking_total = self._get_booking_total(self.booking_from_date, self.booking_to_date)
        return self.update({'booking_total': booking_total})

    """Function"""

    def _default_session(self, cr, uid, context=None):
        so = self.pool.get('lounge.session')
        session_ids = so.search(cr, uid, [('state', '=', 'opened'), ('user_id', '=', uid)], context=context)
        return session_ids and session_ids[0] or False

    def _default_pricelist(self, cr, uid, context=None):
        session_ids = self._default_session(cr, uid, context)
        if session_ids:
            session_record = self.pool.get('lounge.session').browse(cr, uid, session_ids, context=context)
            return session_record.config_id.pricelist_id and session_record.config_id.pricelist_id.id or False
        return False

    """Function """

    _defaults = {
        'user_id': lambda self, cr, uid, context: uid,
        'state': 'draft',
        'flight_type':'domestic',
        'flight_number':'-',
        'name': '/',
        'date_order': lambda *a: datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'booking_from_date': lambda *a: datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'booking_to_date': lambda *a: datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'is_checkout': False,
        'booking_total': 0,
        'nb_print': 0,
        'sequence_number': 1,
        'session_id': _default_session,
        'company_id': lambda self, cr, uid, c: self.pool.get('res.users').browse(cr, uid, uid, c).company_id.id,
        'pricelist_id': _default_pricelist,
    }

    """
    Start of On Change Event
    """

    def onchange_partner_id(self, cr, uid, ids, part=False, context=None):
        if not part:
            return {'value': {}}
        pricelist = self.pool.get('res.partner').browse(cr, uid, part, context=context).property_product_pricelist.id
        return {'value': {'pricelist_id': pricelist}}

    """
    End of On Change Event
    """

    def _get_booking_total(self, booking_from_date, booking_to_date):
        if (booking_from_date and booking_to_date):
            d_frm_obj = datetime.strptime(booking_from_date, DEFAULT_SERVER_DATETIME_FORMAT)
            d_to_obj = datetime.strptime(booking_to_date, DEFAULT_SERVER_DATETIME_FORMAT)
            diff = d_to_obj - d_frm_obj
            hours = (diff.seconds) / 3600
            diff_days = diff.days
            days_hours = diff_days * 24
            total_hours = days_hours + hours
            return total_hours
        else:
            return 0

    def write(self, cr, uid, ids, vals, context=None):
        """
        booking_from_date = time.strftime('%Y-%m-%d %H:%M:%S')
        booking_to_date = time.strftime('%Y-%m-%d %H:%M:%S')
        if(vals.get('booking_from_date')):
            for record in self.browse(cr, uid, ids, context=context):
                booking_from_date = vals['booking_from_date']
                booking_to_date = record.booking_to_date

        if (vals.get('booking_to_date')):
            for record in self.browse(cr, uid, ids, context=context):
                booking_from_date = record.booking_from_date
                booking_to_date = vals['booking_to_date']

        if (vals.get('booking_from_date') and vals.get('booking_to_date')):
            booking_from_date = vals['booking_from_date']
            booking_to_date = vals['booking_to_date']

        vals = {
            'booking_total': self._get_booking_total(booking_from_date, booking_to_date),
        }
        """
        res = super(lounge_order, self).write(cr, uid, ids, vals, context=context)
        partner_obj = self.pool.get('res.partner')
        bsl_obj = self.pool.get("account.bank.statement.line")
        if 'partner_id' in vals:
            for loungeorder in self.browse(cr, uid, ids, context=context):
                if loungeorder.invoice_id:
                    raise UserError(_(
                        "You cannot change the partner of a Lounge order for which an invoice has already been issued."))
                if vals['partner_id']:
                    p_id = partner_obj.browse(cr, uid, vals['partner_id'], context=context)
                    part_id = partner_obj._find_accounting_partner(p_id).id
                else:
                    part_id = False
                bsl_ids = [x.id for x in loungeorder.statement_ids]
                bsl_obj.write(cr, uid, bsl_ids, {'partner_id': part_id}, context=context)
        return res

    def create(self, cr, uid, values, context=None):
        # raise Warning(values['booking_from_date']) //check data
        if values.get('session_id'):
            # set name based on the sequence specified on the config
            session = self.pool['lounge.session'].browse(cr, uid, values['session_id'], context=context)
            # values['booking_total'] = self._get_booking_total(values['booking_from_date'],values['booking_to_date'])
            values['name'] = session.config_id.sequence_id._next()
            values.setdefault('session_id', session.config_id.pricelist_id.id)
        else:
            # fallback on any lounge.order sequence
            # values['booking_total'] = self._get_booking_total(values['booking_from_date'], values['booking_to_date'])
            values['name'] = self.pool.get('ir.sequence').next_by_code(cr, uid, 'lounge.order', context=context)
        return super(lounge_order, self).create(cr, uid, values, context=context)

    def unlink(self, cr, uid, ids, context=None):
        for rec in self.browse(cr, uid, ids, context=context):
            if rec.state not in ('draft', 'cancel'):
                raise UserError(_('In order to delete a lounge order, it must be new or cancelled.'))
        return super(lounge_order, self).unlink(cr, uid, ids, context=context)

    """ End of Override Event """

    """ Parsing Data From Payment View """

    def add_payment(self, cr, uid, order_id, data, context=None):
        """Create a new payment for the order"""
        context = dict(context or {})
        statement_line_obj = self.pool.get('account.bank.statement.line')
        property_obj = self.pool.get('ir.property')
        order = self.browse(cr, uid, order_id, context=context)
        date = data.get('payment_date', time.strftime('%Y-%m-%d'))
        if len(date) > 10:
            timestamp = datetime.strptime(date, tools.DEFAULT_SERVER_DATETIME_FORMAT)
            ts = fields.datetime.context_timestamp(cr, uid, timestamp, context)
            date = ts.strftime(tools.DEFAULT_SERVER_DATE_FORMAT)
        args = {
            'amount': data['amount'],
            'date': date,
            'name': order.name + ': ' + (data.get('payment_name', '') or ''),
            'partner_id': order.partner_id and self.pool.get("res.partner")._find_accounting_partner(
                order.partner_id).id or False,
        }
        journal_id = data.get('journal', False)
        statement_id = data.get('statement_id', False)
        assert journal_id or statement_id, "No statement_id or journal_id passed to the method!"
        journal = self.pool['account.journal'].browse(cr, uid, journal_id, context=context)
        # use the company of the journal and not of the current user
        company_cxt = dict(context, force_company=journal.company_id.id)
        account_def = property_obj.get(cr, uid, 'property_account_receivable_id', 'res.partner', context=company_cxt)
        args['account_id'] = (order.partner_id and order.partner_id.property_account_receivable_id \
                              and order.partner_id.property_account_receivable_id.id) or (
                                 account_def and account_def.id) or False

        if not args['account_id']:
            if not args['partner_id']:
                msg = _('There is no receivable account defined to make payment.')
            else:
                msg = _('There is no receivable account defined to make payment for the partner: "%s" (id:%d).') % (
                order.partner_id.name, order.partner_id.id,)
            raise UserError(msg)

        context.pop('lounge_session_id', False)

        for statement in order.session_id.statement_ids:
            if statement.id == statement_id:
                journal_id = statement.journal_id.id
                break
            elif statement.journal_id.id == journal_id:
                statement_id = statement.id
                break

        if not statement_id:
            raise UserError(_('You have to open at least one cashbox.'))

        args.update({
            'statement_id': statement_id,
            'lounge_statement_id': order_id,
            'journal_id': journal_id,
            'ref': order.session_id.name,
        })

        statement_line_obj.create(cr, uid, args, context=context)
        return statement_id

    def add_checkout_payment(self, cr, uid, order_id, data, context=None):
        """Create a new payment for the order"""
        context = dict(context or {})
        statement_line_obj = self.pool.get('account.bank.statement.line')
        property_obj = self.pool.get('ir.property')
        order = self.browse(cr, uid, order_id, context=context)
        date = data.get('payment_date', time.strftime('%Y-%m-%d'))
        if len(date) > 10:
            timestamp = datetime.strptime(date, tools.DEFAULT_SERVER_DATETIME_FORMAT)
            ts = fields.datetime.context_timestamp(cr, uid, timestamp, context)
            date = ts.strftime(tools.DEFAULT_SERVER_DATE_FORMAT)
        args = {
            'amount': data['amount'],
            'date': date,
            'name': order.name + ': ' + (data.get('payment_name', '') or ''),
            'partner_id': order.partner_id and self.pool.get("res.partner")._find_accounting_partner(
                order.partner_id).id or False,
        }

        journal_id = data.get('journal', False)
        statement_id = data.get('statement_id', False)
        assert journal_id or statement_id, "No statement_id or journal_id passed to the method!"
        journal = self.pool['account.journal'].browse(cr, uid, journal_id, context=context)
        # use the company of the journal and not of the current user
        company_cxt = dict(context, force_company=journal.company_id.id)
        account_def = property_obj.get(cr, uid, 'property_account_receivable_id', 'res.partner', context=company_cxt)
        args['account_id'] = (order.partner_id and order.partner_id.property_account_receivable_id \
                              and order.partner_id.property_account_receivable_id.id) or (
                                 account_def and account_def.id) or False

        if not args['account_id']:
            if not args['partner_id']:
                msg = _('There is no receivable account defined to make payment.')
            else:
                msg = _('There is no receivable account defined to make payment for the partner: "%s" (id:%d).') % (
                    order.partner_id.name, order.partner_id.id,)
            raise UserError(msg)

        context.pop('lounge_session_id', False)

        for statement in order.session_id.statement_ids:
            if statement.id == statement_id:
                journal_id = statement.journal_id.id
                break
            elif statement.journal_id.id == journal_id:
                statement_id = statement.id
                break

        if not statement_id:
            raise UserError(_('You have to open at least one cashbox.'))

        args.update({
            'statement_id': statement_id,
            'lounge_statement_id': order_id,
            'journal_id': journal_id,
            'ref': order.session_id.name,
        })

        statement_line_obj.create(cr, uid, args, context=context)
        return statement_id

    # function update stock
    def create_picking(self, cr, uid, ids, context=None):
        """Create a picking for each order and validate it."""
        picking_obj = self.pool.get('stock.picking')
        partner_obj = self.pool.get('res.partner')
        move_obj = self.pool.get('stock.move')
        for order in self.browse(cr, uid, ids, context=context):
            if all(t == 'service' for t in order.lines.mapped('product_id.type')):
                continue
            addr = order.partner_id and partner_obj.address_get(cr, uid, [order.partner_id.id], ['delivery']) or {}
            picking_type = order.picking_type_id
            picking_id = False
            location_id = order.location_id.id
            if order.partner_id:
                destination_id = order.partner_id.property_stock_customer.id
            else:
                if (not picking_type) or (not picking_type.default_location_dest_id):
                    customerloc, supplierloc = self.pool['stock.warehouse']._get_partner_locations(cr, uid, [],
                                                                                                   context=context)
                    destination_id = customerloc.id
                else:
                    destination_id = picking_type.default_location_dest_id.id

            # All qties negative => Create negative
            if picking_type:
                pos_qty = all([x.qty >= 0 for x in order.lines])
                # Check negative quantities
                picking_id = picking_obj.create(cr, uid, {
                    'origin': order.name,
                    'partner_id': addr.get('delivery', False),
                    'date_done': order.date_order,
                    'picking_type_id': picking_type.id,
                    'company_id': order.company_id.id,
                    'move_type': 'direct',
                    'note': order.note or "",
                    'location_id': location_id if pos_qty else destination_id,
                    'location_dest_id': destination_id if pos_qty else location_id,
                }, context=context)
                self.write(cr, uid, [order.id], {'picking_id': picking_id}, context=context)

            move_list = []
            for line in order.lines:
                if line.product_id and line.product_id.type not in ['product', 'consu']:
                    continue

                move_list.append(move_obj.create(cr, uid, {
                    'name': line.name,
                    'product_uom': line.product_id.uom_id.id,
                    'picking_id': picking_id,
                    'picking_type_id': picking_type.id,
                    'product_id': line.product_id.id,
                    'product_uom_qty': abs(line.qty),
                    'state': 'draft',
                    'location_id': location_id if line.qty >= 0 else destination_id,
                    'location_dest_id': destination_id if line.qty >= 0 else location_id,
                }, context=context))

            if picking_id:
                picking_obj.action_confirm(cr, uid, [picking_id], context=context)
                picking_obj.force_assign(cr, uid, [picking_id], context=context)
                # Mark pack operations as done
                pick = picking_obj.browse(cr, uid, picking_id, context=context)
                for pack in pick.pack_operation_ids:
                    self.pool['stock.pack.operation'].write(cr, uid, [pack.id], {'qty_done': pack.product_qty},
                                                            context=context)
                picking_obj.action_done(cr, uid, [picking_id], context=context)
            elif move_list:
                move_obj.action_confirm(cr, uid, move_list, context=context)
                move_obj.force_assign(cr, uid, move_list, context=context)
                move_obj.action_done(cr, uid, move_list, context=context)

        return True

    # function analytic account
    def _prepare_analytic_account(self, cr, uid, line, context=None):
        '''This method is designed to be inherited in a custom module'''
        return False

    def test_paid(self, cr, uid, ids, context=None):
        """A Lounge is paid when the sum
        @return: True
        """
        for order in self.browse(cr, uid, ids, context=context):
            if order.lines and not order.amount_total:
                return True
            if (not order.lines) or (not order.statement_ids) or \
                    (abs(order.amount_total - order.amount_paid) > 0.00001):
                return False
        return True
        """ Parsing Data From Payment View """

    def action_paid(self, cr, uid, ids, context=None):
        self.write(cr, uid, ids, {'state': 'paid'}, context=context)
        self.create_picking(cr, uid, ids, context=context)
        return True

    def action_invoice(self, cr, uid, ids, context=None):
        inv_ref = self.pool.get('account.invoice')
        inv_line_ref = self.pool.get('account.invoice.line')
        product_obj = self.pool.get('product.product')
        inv_ids = []

        for order in self.pool.get('lounge.order').browse(cr, uid, ids, context=context):
            # Force company for all SUPERUSER_ID action
            company_id = order.company_id.id
            local_context = dict(context or {}, force_company=company_id, company_id=company_id)
            if order.invoice_id:
                inv_ids.append(order.invoice_id.id)
                continue

            if not order.partner_id:
                raise UserError(_('Please provide a partner for the sale.'))

            acc = order.partner_id.property_account_receivable_id.id
            inv = {
                'name': order.name,
                'origin': order.name,
                'account_id': acc,
                'journal_id': order.sale_journal.id or None,
                'type': 'out_invoice',
                'reference': order.name,
                'partner_id': order.partner_id.id,
                'comment': order.note or '',
                'currency_id': order.pricelist_id.currency_id.id,  # considering partner's sale pricelist's currency
                'company_id': company_id,
                'user_id': uid,
            }

            invoice = inv_ref.new(cr, uid, inv)
            invoice._onchange_partner_id()
            invoice.fiscal_position_id = order.fiscal_position_id
            inv = invoice._convert_to_write(invoice._cache)
            if not inv.get('account_id', None):
                inv['account_id'] = acc
            inv_id = inv_ref.create(cr, SUPERUSER_ID, inv, context=local_context)
            self.write(cr, uid, [order.id], {'invoice_id': inv_id, 'state': 'invoiced'}, context=local_context)
            inv_ids.append(inv_id)
            for line in order.lines:
                inv_name = product_obj.name_get(cr, uid, [line.product_id.id], context=local_context)[0][1]
                inv_line = {
                    'invoice_id': inv_id,
                    'product_id': line.product_id.id,
                    'quantity': line.qty,
                    'account_analytic_id': self._prepare_analytic_account(cr, uid, line, context=local_context),
                    'name': inv_name,
                }

                # Oldlink trick
                invoice_line = inv_line_ref.new(cr, SUPERUSER_ID, inv_line, context=local_context)
                invoice_line._onchange_product_id()
                invoice_line.invoice_line_tax_ids = [tax.id for tax in invoice_line.invoice_line_tax_ids if
                                                     tax.company_id.id == company_id]
                fiscal_position_id = line.order_id.fiscal_position_id
                if fiscal_position_id:
                    invoice_line.invoice_line_tax_ids = fiscal_position_id.map_tax(invoice_line.invoice_line_tax_ids)
                invoice_line.invoice_line_tax_ids = [tax.id for tax in invoice_line.invoice_line_tax_ids]
                # We convert a new id object back to a dictionary to write to bridge between old and new api
                inv_line = invoice_line._convert_to_write(invoice_line._cache)
                inv_line.update(price_unit=line.price_unit, discount=line.discount)
                inv_line_ref.create(cr, SUPERUSER_ID, inv_line, context=local_context)

            inv_ref.compute_taxes(cr, SUPERUSER_ID, [inv_id], context=local_context)
            self.signal_workflow(cr, uid, [order.id], 'invoice')
            inv_ref.signal_workflow(cr, SUPERUSER_ID, [inv_id], 'validate')

        if not inv_ids: return {}

        mod_obj = self.pool.get('ir.model.data')
        res = mod_obj.get_object_reference(cr, uid, 'account', 'invoice_form')
        res_id = res and res[1] or False

        return {
            'name': _('Customer Invoice'),
            'view_type': 'form',
            'view_mode': 'form',
            'view_id': [res_id],
            'res_model': 'account.invoice',
            'context': "{'type':'out_invoice'}",
            'type': 'ir.actions.act_window',
            'target': 'current',
            'res_id': inv_ids and inv_ids[0] or False,
        }

    def action_invoice_state(self, cr, uid, ids, context=None):
        return self.write(cr, uid, ids, {'state': 'invoiced'}, context=context)

    # on submit button refund
    def refund(self, cr, uid, ids, context=None):
        """Create a copy of order  for refund order"""
        clone_list = []
        line_obj = self.pool.get('lounge.order.line')

        for order in self.browse(cr, uid, ids, context=context):
            current_session_ids = self.pool.get('lounge.session').search(cr, uid, [('state', '!=', 'closed'),
                                                                                   ('user_id', '=', uid)],
                                                                         context=context)
            if not current_session_ids:
                raise UserError(
                    _('To return product(s), you need to open a session that will be used to register the refund.'))

            clone_id = self.copy(cr, uid, order.id, {
                'name': order.name + ' REFUND',  # not used, name forced by create
                'session_id': current_session_ids[0],
                'date_order': time.strftime('%Y-%m-%d %H:%M:%S'),
            }, context=context)
            clone_list.append(clone_id)

        for clone in self.browse(cr, uid, clone_list, context=context):
            for order_line in clone.lines:
                line_obj.write(cr, uid, [order_line.id], {
                    'qty': -order_line.qty
                }, context=context)

        abs = {
            'name': _('Return Products'),
            'view_type': 'form',
            'view_mode': 'form',
            'res_model': 'lounge.order',
            'res_id': clone_list[0],
            'view_id': False,
            'context': context,
            'type': 'ir.actions.act_window',
            'target': 'current',
        }
        return abs

    def create_account_move(self, cr, uid, ids, context=None):
        return self._create_account_move_line(cr, uid, ids, None, None, context=context)

    def _create_account_move(self, cr, uid, dt, ref, journal_id, company_id, context=None):
        start_at_datetime = datetime.strptime(dt, tools.DEFAULT_SERVER_DATETIME_FORMAT)
        date_tz_user = fields.datetime.context_timestamp(cr, uid, start_at_datetime, context=context)
        date_tz_user = date_tz_user.strftime(tools.DEFAULT_SERVER_DATE_FORMAT)
        return self.pool['account.move'].create(cr, SUPERUSER_ID,
                                                {'ref': ref, 'journal_id': journal_id, 'date': date_tz_user},
                                                context=context)

    def _create_account_move_line(self, cr, uid, ids, session=None, move_id=None, context=None):
        # Tricky, via the workflow, we only have one id in the ids variable
        """Create a account move line of order grouped by products or not."""
        account_move_obj = self.pool.get('account.move')
        account_tax_obj = self.pool.get('account.tax')
        property_obj = self.pool.get('ir.property')
        cur_obj = self.pool.get('res.currency')

        # session_ids = set(order.session_id for order in self.browse(cr, uid, ids, context=context))

        if session and not all(
                        session.id == order.session_id.id for order in self.browse(cr, uid, ids, context=context)):
            raise UserError(_('Selected orders do not have the same session!'))

        grouped_data = {}
        have_to_group_by = session and session.config_id.group_by or False

        for order in self.browse(cr, uid, ids, context=context):
            if order.account_move:
                continue
            if order.state != 'paid':
                continue

            current_company = order.sale_journal.company_id

            group_tax = {}
            account_def = property_obj.get(cr, uid, 'property_account_receivable_id', 'res.partner', context=context)

            order_account = order.partner_id and \
                            order.partner_id.property_account_receivable_id and \
                            order.partner_id.property_account_receivable_id.id or \
                            account_def and account_def.id

            if move_id is None:
                # Create an entry for the sale
                move_id = self._create_account_move(cr, uid, order.session_id.start_at, order.name,
                                                    order.sale_journal.id, order.company_id.id, context=context)

            move = account_move_obj.browse(cr, SUPERUSER_ID, move_id, context=context)

            def insert_data(data_type, values):
                # if have_to_group_by:

                # 'quantity': line.qty,
                # 'product_id': line.product_id.id,
                values.update({
                    'partner_id': order.partner_id and self.pool.get("res.partner")._find_accounting_partner(
                        order.partner_id).id or False,
                    'move_id': move_id,
                })

                if data_type == 'product':
                    key = ('product', values['partner_id'],
                           (values['product_id'], tuple(values['tax_ids'][0][2]), values['name']),
                           values['analytic_account_id'], values['debit'] > 0)
                elif data_type == 'tax':
                    key = ('tax', values['partner_id'], values['tax_line_id'], values['debit'] > 0)
                elif data_type == 'counter_part':
                    key = ('counter_part', values['partner_id'], values['account_id'], values['debit'] > 0)
                else:
                    return

                grouped_data.setdefault(key, [])

                # if not have_to_group_by or (not grouped_data[key]):
                #     grouped_data[key].append(values)
                # else:
                #     pass

                if have_to_group_by:
                    if not grouped_data[key]:
                        grouped_data[key].append(values)
                    else:
                        for line in grouped_data[key]:
                            if line.get('tax_code_id') == values.get('tax_code_id'):
                                current_value = line
                                current_value['quantity'] = current_value.get('quantity', 0.0) + values.get('quantity',
                                                                                                            0.0)
                                current_value['credit'] = current_value.get('credit', 0.0) + values.get('credit', 0.0)
                                current_value['debit'] = current_value.get('debit', 0.0) + values.get('debit', 0.0)
                                break
                        else:
                            grouped_data[key].append(values)
                else:
                    grouped_data[key].append(values)

            # because of the weird way the lounge order is written, we need to make sure there is at least one line,
            # because just after the 'for' loop there are references to 'line' and 'income_account' variables (that
            # are set inside the for loop)
            # TOFIX: a deep refactoring of this method (and class!) is needed in order to get rid of this stupid hack
            assert order.lines, _('The Lounge order must have lines when calling this method')
            # Create an move for each order line

            cur = order.pricelist_id.currency_id
            for line in order.lines:
                amount = line.price_subtotal

                # Search for the income account
                if line.product_id.property_account_income_id.id:
                    income_account = line.product_id.property_account_income_id.id
                elif line.product_id.categ_id.property_account_income_categ_id.id:
                    income_account = line.product_id.categ_id.property_account_income_categ_id.id
                else:
                    raise UserError(_('Please define income ' \
                                      'account for this product: "%s" (id:%d).') \
                                    % (line.product_id.name, line.product_id.id))

                name = line.product_id.name
                if line.notice:
                    # add discount reason in move
                    name = name + ' (' + line.notice + ')'

                # Create a move for the line for the order line
                insert_data('product', {
                    'name': name,
                    'quantity': line.qty,
                    'product_id': line.product_id.id,
                    'account_id': income_account,
                    'analytic_account_id': self._prepare_analytic_account(cr, uid, line, context=context),
                    'credit': ((amount > 0) and amount) or 0.0,
                    'debit': ((amount < 0) and -amount) or 0.0,
                    'tax_ids': [(6, 0, line.tax_ids_after_fiscal_position.ids)],
                    'partner_id': order.partner_id and self.pool.get("res.partner")._find_accounting_partner(
                        order.partner_id).id or False
                })

                # Create the tax lines
                taxes = []
                for t in line.tax_ids_after_fiscal_position:
                    if t.company_id.id == current_company.id:
                        taxes.append(t.id)
                if not taxes:
                    continue
                for tax in account_tax_obj.browse(cr, uid, taxes, context=context).compute_all(
                                (line.price_unit * (100.0 - line.discount) / 100.0) + line.charge, cur, line.qty)[
                    'taxes']:
                    insert_data('tax', {
                        'name': _('Tax') + ' ' + tax['name'],
                        'product_id': line.product_id.id,
                        'quantity': line.qty,
                        'account_id': tax['account_id'] or income_account,
                        'credit': ((tax['amount'] > 0) and tax['amount']) or 0.0,
                        'debit': ((tax['amount'] < 0) and -tax['amount']) or 0.0,
                        'tax_line_id': tax['id'],
                        'partner_id': order.partner_id and self.pool.get("res.partner")._find_accounting_partner(
                            order.partner_id).id or False
                    })

            # counterpart
            insert_data('counter_part', {
                'name': _("Trade Receivables"),  # order.name,
                'account_id': order_account,
                'credit': ((order.amount_total < 0) and -order.amount_total) or 0.0,
                'debit': ((order.amount_total > 0) and order.amount_total) or 0.0,
                'partner_id': order.partner_id and self.pool.get("res.partner")._find_accounting_partner(
                    order.partner_id).id or False
            })

            order.write({'state': 'done', 'account_move': move_id})

        all_lines = []
        for group_key, group_data in grouped_data.iteritems():
            for value in group_data:
                all_lines.append((0, 0, value), )
        if move_id:  # In case no order was changed
            self.pool.get("account.move").write(cr, SUPERUSER_ID, [move_id], {'line_ids': all_lines},
                                                context=dict(context or {}, dont_create_taxes=True))
            self.pool.get("account.move").post(cr, SUPERUSER_ID, [move_id], context=context)

        return True

    def _get_valid_session(self, cr, uid, order, context=None):
        session = self.pool.get('lounge.session')
        closed_session = session.browse(cr, uid, order['lounge_session_id'], context=context)
        open_sessions = session.search(cr, uid, [('state', '=', 'opened'),
                                                 ('config_id', '=', closed_session.config_id.id),
                                                 ('user_id', '=', closed_session.user_id.id)],
                                       limit=1, order="start_at DESC", context=context)

        _logger.warning('session %s (ID: %s) was closed but received order %s (total: %s) belonging to it',
                        closed_session.name,
                        closed_session.id,
                        order['name'],
                        order['amount_total'])

        if open_sessions:
            open_session = session.browse(cr, uid, open_sessions[0], context=context)
            _logger.warning('using session %s (ID: %s) for order %s instead',
                            open_session.name,
                            open_session.id,
                            order['name'])
            return open_session.id
        else:
            _logger.warning('attempting to create new session for order %s', order['name'])
            new_session_id = session.create(cr, uid, {
                'config_id': closed_session.config_id.id,
            }, context=context)
            new_session = session.browse(cr, uid, new_session_id, context=context)
            # bypass opening_control (necessary when using cash control)
            new_session.signal_workflow('open')
            return new_session_id


class lounge_order_line(osv.osv):
    _name = "lounge.order.line"
    _description = "Lines of Lounge"
    _rec_name = "product_id"

    """Function"""

    def _order_line_fields(self, cr, uid, line, context=None):
        if line and 'tax_ids' not in line[2]:
            product = self.pool['product.product'].browse(cr, uid, line[2]['product_id'], context=context)
            line[2]['tax_ids'] = [(6, 0, [x.id for x in product.taxes_id])]
        return line

    def _get_tax_ids_after_fiscal_position(self, cr, uid, ids, field_name, args, context=None):
        res = dict.fromkeys(ids, False)
        for line in self.browse(cr, uid, ids, context=context):
            res[line.id] = line.order_id.fiscal_position_id.map_tax(line.tax_ids)
        return res

    """Function"""

    _columns = {
        'name': fields.char('Line No', required=True, copy=False),
        'order_id': fields.many2one('lounge.order', 'Order Ref', ondelete='cascade'),
        'product_id': fields.many2one('product.product', 'Product', domain=[('sale_ok', '=', True)], required=True,
                                      change_default=True),
        'lounge_charge': fields.related('product_id','lounge_charge',string='Charge',type='float'),
        'lounge_charge_every': fields.related('product_id', 'lounge_charge_every', string='Charge Every', type='integer'),
        'qty': fields.float('Pax(s)', digits_compute=dp.get_precision('Product Unit of Measure')),
        'charge': fields.float('Charge', digits=0),
        'discount': fields.float('Discount (%)', digits=0),
        'price_unit': fields.float(string='Unit Price', digits=0),
        'tax_ids_after_fiscal_position': fields.function(_get_tax_ids_after_fiscal_position, type='many2many',
                                                         relation='account.tax', string='Taxes'),
        'tax_ids': fields.many2many('account.tax', string='Taxes'),
        'create_date': fields.datetime('Creation Date', readonly=True),
        'notice': fields.char('Discount Notice'),
        'company_id': fields.many2one('res.company', 'Company', required=True),
    }

    """SUM Function with compute """
    price_charge = Fields.Float(compute='_compute_amount_line_all', digits=0, string='Total Charge')
    price_subtotal = Fields.Float(compute='_compute_amount_line_all', digits=0, string='Subtotal w/o Tax')
    price_subtotal_incl = Fields.Float(compute='_compute_amount_line_all', digits=0, string='Subtotal')

    # defination api
    @api.depends('price_unit', 'tax_ids', 'charge', 'qty', 'discount', 'product_id')
    def _compute_amount_line_all(self):
        for line in self:
            currency = line.order_id.pricelist_id.currency_id
            taxes = line.tax_ids.filtered(lambda tax: tax.company_id.id == line.order_id.company_id.id)
            fiscal_position_id = line.order_id.fiscal_position_id
            if fiscal_position_id:
                taxes = fiscal_position_id.map_tax(taxes)
            price = line.price_unit * (1 - (line.discount or 0.0) / 100.0)
            price = price + line.charge

            line.price_charge = line.charge * line.qty
            line.price_subtotal = line.price_subtotal_incl = price * line.qty

            if taxes:
                taxes = taxes.compute_all(price, currency, line.qty, product=line.product_id,
                                          partner=line.order_id.partner_id or False)
                # line.price_charge = taxes['total_charge']
                line.price_subtotal = taxes['total_excluded']
                line.price_subtotal_incl = taxes['total_included']

            line.price_charge = currency.round(line.price_charge)
            line.price_subtotal = currency.round(line.price_subtotal)
            line.price_subtotal_incl = currency.round(line.price_subtotal_incl)

    """SUM Function with compute """

    _defaults = {
        'name': lambda obj, cr, uid, context: obj.pool.get('ir.sequence').next_by_code(cr, uid, 'lounge.order.line',
                                                                                       context=context),
        'qty': lambda *a: 1,
        'discount': lambda *a: 0.0,
        'charge': lambda *a: 0.0,
        'company_id': lambda self, cr, uid, c: self.pool.get('res.users').browse(cr, uid, uid, c).company_id.id,
    }

    """On Change Event"""

    def onchange_product_id(self, cr, uid, ids, booking_total, pricelist, product_id, charge, qty=0, partner_id=False,
                            context=None):
        context = context or {}
        if not product_id:
            return {}

        if not pricelist:
            raise UserError(
                _('You have to select a pricelist in the sale form , Please set one before choosing a product.'))

        price = self.pool.get('product.pricelist').price_get(cr, uid, [pricelist], product_id, qty or 1.0, partner_id)[
            pricelist]
        result = self.onchange_qty(cr, uid, ids, pricelist, product_id, 0.0, charge, qty, price, context=context)
        result['value']['price_unit'] = price

        prod = self.pool.get('product.product').browse(cr, uid, product_id, context=context)

        if (booking_total):
            booking_total = booking_total
        else:
            booking_total = 0

        if (prod.lounge_charge_every > 0):
            total_charge = int(math.ceil(booking_total / prod.lounge_charge_every))
        else:
            total_charge = 0

        product_charge = int(round((prod.lounge_charge / 100) * price))

        if (total_charge > 1):
            surcharge = (total_charge - 1) * product_charge
        else:
            surcharge = 0

        result['value']['charge'] = surcharge
        result['value']['tax_ids'] = prod.taxes_id.ids
        return result

    def onchange_qty(self, cr, uid, ids, pricelist, product, discount, charge, qty, price_unit, context=None):
        result = {}
        if not product:
            return result
        if not pricelist:
            raise UserError(_('You have to select a pricelist in the sale form !'))

        account_tax_obj = self.pool.get('account.tax')
        prod = self.pool.get('product.product').browse(cr, uid, product, context=context)
        price = price_unit * (1 - (discount or 0.0) / 100.0)
        price = price + charge
        result['price_charge'] = charge * qty
        result['price_subtotal'] = result['price_subtotal_incl'] = price * qty
        cur = self.pool.get('product.pricelist').browse(cr, uid, [pricelist], context=context).currency_id
        if (prod.taxes_id):
            taxes = prod.taxes_id.compute_all(price, cur, qty, product=prod, partner=False)
            # result['price_charge'] = taxes['total_charge']
            result['price_subtotal'] = taxes['total_excluded']
            result['price_subtotal_incl'] = taxes['total_included']

        return {'value': result}

    """On Change Event"""


class account_bank_statement_line(osv.osv):
    _inherit = 'account.bank.statement.line'
    _columns = {
        'lounge_statement_id': fields.many2one('lounge.order', string="Lounge statement", ondelete='cascade'),
    }
