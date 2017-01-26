# -*- coding: utf-8 -*-
from openerp import tools
from openerp.osv import fields,osv

class lounge_order_report(osv.osv):
	_name = "report.lounge.order"
	_description = "Lounge Orders Statistics"
	#_auto = False
	_order = 'date desc'

	_columns = {
		'date': fields.datetime('Date Order', readonly=True),
		'partner_id': fields.many2one('res.partner', 'Partner', readonly=True),
		'product_id': fields.many2one('product.product', 'Product', readonly=True),
		'product_tmpl_id': fields.many2one('product.template', 'Product Template', readonly=True),
		'state': fields.selection(
			[('draft', 'New'), ('paid', 'Paid'), ('done', 'Posted'), ('invoiced', 'Invoiced'), ('cancel', 'Cancelled')],
			'Status'),
		'user_id': fields.many2one('res.users', 'Salesperson', readonly=True),
		'price_total': fields.float('Total Price', readonly=True),
		'price_sub_total': fields.float('Subtotal w/o discount', readonly=True),
		'total_discount': fields.float('Total Discount', readonly=True),
		'average_price': fields.float('Average Price', readonly=True, group_operator="avg"),
		'location_id': fields.many2one('stock.location', 'Location', readonly=True),
		'company_id': fields.many2one('res.company', 'Company', readonly=True),
		'nbr': fields.integer('# of Lines', readonly=True),  # TDE FIXME master: rename into nbr_lines
		'product_qty': fields.integer('Product Quantity', readonly=True),
		'journal_id': fields.many2one('account.journal', 'Journal'),
		'delay_validation': fields.integer('Delay Validation'),
		'product_categ_id': fields.many2one('product.category', 'Product Category', readonly=True),
		'invoiced': fields.boolean('Invoiced', readonly=True),
		'config_id': fields.many2one('lounge.config', 'Point of Sale', readonly=True),
		'lounge_categ_id': fields.many2one('lounge.category', 'Public Category', readonly=True),
		'stock_location_id': fields.many2one('stock.location', 'Warehouse', readonly=True),
		'pricelist_id': fields.many2one('product.pricelist', 'Pricelist', readonly=True),
	}

	#def init(self, cr):
		#tools.drop_view_if_exists(cr, 'report_lounge_order')

