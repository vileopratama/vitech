# -*- coding: utf-8 -*-
from openerp.osv import osv
from openerp.report import report_sxw
import time
import pytz
import datetime
from openerp import tools

class lounge_details(report_sxw.rml_parse):

	def _get_user_names(self, user_ids):
		user_obj = self.pool.get('res.users')
		return ', '.join(map(lambda x: x.name, user_obj.browse(self.cr, self.uid, user_ids)))

	def _get_all_users(self):
		user_obj = self.pool.get('res.users')
		return user_obj.search(self.cr, self.uid, [])

	def _get_utc_time_range(self, form):
		user = self.pool['res.users'].browse(self.cr, self.uid, self.uid)
		tz_name = user.tz or self.localcontext.get('tz') or 'UTC'
		user_tz = pytz.timezone(tz_name)
		between_dates = {}

		for date_field, delta in {'date_start': {'days': 0}, 'date_end': {'days': 1}}.items():
			timestamp = datetime.datetime.strptime(form[date_field] + ' 00:00:00',
			                                       tools.DEFAULT_SERVER_DATETIME_FORMAT) + datetime.timedelta(**delta)
			timestamp = user_tz.localize(timestamp).astimezone(pytz.utc)
			between_dates[date_field] = timestamp.strftime(tools.DEFAULT_SERVER_DATETIME_FORMAT)

		return between_dates['date_start'], between_dates['date_end']

	def _lounge_sales_details(self, form):
		lounge_obj = self.pool.get('lounge.order')
		user_obj = self.pool.get('res.users')
		data = []
		result = {}
		user_ids = form['user_ids'] or self._get_all_users()
		company_id = user_obj.browse(self.cr, self.uid, self.uid).company_id.id
		date_start, date_end = self._get_utc_time_range(form)

		lounge_ids = lounge_obj.search(self.cr, self.uid, [
			('date_order', '>=', date_start),
			('date_order', '<', date_end),
			('user_id', 'in', user_ids),
			('state', 'in', ['done', 'paid', 'invoiced']),
			('company_id', '=', company_id)
		])

		for lounge in lounge_obj.browse(self.cr, self.uid, lounge_ids, context=self.localcontext):
			for pol in lounge.lines:
				result = {
					'code': pol.product_id.default_code,
					'name': pol.product_id.name,
					'invoice_id': lounge.invoice_id.id,
					'price_unit': pol.price_unit,
					'charge': pol.charge,
					'qty': pol.qty,
					'discount': pol.discount,
					'total': ((pol.price_unit * pol.qty * (1 - (pol.discount) / 100.0)) + (pol.charge * pol.qty)),
					'date_order': lounge.date_order,
					'lounge_name': lounge.name,
					'uom': pol.product_id.uom_id.name
				}

				data.append(result)
				self.charge += result['charge']
				self.qty += result['qty']
				self.discount += result['discount']
		self.total += lounge.amount_total

		if data:
			return data
		else:
			return {}

	def _get_tax_amount(self, form):
		taxes = {}
		account_tax_obj = self.pool.get('account.tax')
		user_ids = form['user_ids'] or self._get_all_users()
		lounge_order_obj = self.pool.get('lounge.order')
		company_id = self.pool['res.users'].browse(self.cr, self.uid, self.uid).company_id.id
		date_start, date_end = self._get_utc_time_range(form)
		lounge_ids = lounge_order_obj.search(self.cr, self.uid,
		                               [('date_order', '>=', date_start), ('date_order', '<=', date_end),
		                                ('state', 'in', ['paid', 'invoiced', 'done']), ('user_id', 'in', user_ids),
		                                ('company_id', '=', company_id)])
		for order in lounge_order_obj.browse(self.cr, self.uid, lounge_ids):
			currency = order.session_id.currency_id
			for line in order.lines:
				if line.tax_ids_after_fiscal_position:
					line_taxes = line.tax_ids_after_fiscal_position.compute_all(
						line.price_unit * (1 - (line.discount or 0.0) / 100.0), currency, line.qty,
						product=line.product_id, partner=line.order_id.partner_id or False)
					for tax in line_taxes['taxes']:
						taxes.setdefault(tax['id'], {'name': tax['name'], 'amount': 0.0})
						taxes[tax['id']]['amount'] += tax['amount']
		return taxes.values()

	def _get_payments(self, form):
		statement_line_obj = self.pool.get("account.bank.statement.line")
		lounge_order_obj = self.pool.get("lounge.order")
		user_ids = form['user_ids'] or self._get_all_users()
		company_id = self.pool['res.users'].browse(self.cr, self.uid, self.uid).company_id.id
		date_start, date_end = self._get_utc_time_range(form)
		lounge_ids = lounge_order_obj.search(self.cr, self.uid,
		                               [('date_order', '>=', date_start), ('date_order', '<=', date_end),
		                                ('state', 'in', ['paid', 'invoiced', 'done']), ('user_id', 'in', user_ids),
		                                ('company_id', '=', company_id)])
		data = {}
		if lounge_ids:
			st_line_ids = statement_line_obj.search(self.cr, self.uid, [('lounge_statement_id', 'in', lounge_ids)])
			if st_line_ids:
				st_id = statement_line_obj.browse(self.cr, self.uid, st_line_ids)
				a_l = []
				for r in st_id:
					a_l.append(r['id'])
				self.cr.execute(
					"select aj.name,sum(amount) from account_bank_statement_line as absl,account_bank_statement as abs,account_journal as aj " \
					"where absl.statement_id = abs.id and abs.journal_id = aj.id  and absl.id IN %s " \
					"group by aj.name ", (tuple(a_l),))

				data = self.cr.dictfetchall()
				return data
		else:
			return {}

	def _get_sales_total_2(self):
		return self.total

	def _get_qty_total_2(self):
		return self.qty

	def _get_sum_invoice_2(self, form):
		lounge_obj = self.pool.get('lounge.order')
		user_obj = self.pool.get('res.users')
		user_ids = form['user_ids'] or self._get_all_users()
		company_id = user_obj.browse(self.cr, self.uid, self.uid).company_id.id
		date_start, date_end = self._get_utc_time_range(form)
		lounge_ids = lounge_obj.search(self.cr, self.uid, [('date_order', '>=', date_start), ('date_order', '<=', date_end),
		                                             ('user_id', 'in', user_ids), ('company_id', '=', company_id),
		                                             ('invoice_id', '<>', False)])
		for lounge in lounge_obj.browse(self.cr, self.uid, lounge_ids):
			for pol in lounge.lines:
				self.total_invoiced += (pol.price_unit * pol.qty * (1 - (pol.discount) / 100.0))
		return self.total_invoiced or False

	def _get_sum_discount(self, form):
		# code for the sum of discount value
		lounge_obj = self.pool.get('lounge.order')
		user_obj = self.pool.get('res.users')
		user_ids = form['user_ids'] or self._get_all_users()
		company_id = user_obj.browse(self.cr, self.uid, self.uid).company_id.id
		date_start, date_end = self._get_utc_time_range(form)
		lounge_ids = lounge_obj.search(self.cr, self.uid, [('date_order', '>=', date_start), ('date_order', '<=', date_end),
		                                             ('user_id', 'in', user_ids), ('company_id', '=', company_id)])
		for lounge in lounge_obj.browse(self.cr, self.uid, lounge_ids):
			for pol in lounge.lines:
				self.total_discount += ((pol.price_unit * pol.qty) * (pol.discount / 100))
		return self.total_discount or False

	def _get_sum_charge(self, form):
		# code for the sum of discount value
		lounge_obj = self.pool.get('lounge.order')
		user_obj = self.pool.get('res.users')
		user_ids = form['user_ids'] or self._get_all_users()
		company_id = user_obj.browse(self.cr, self.uid, self.uid).company_id.id
		date_start, date_end = self._get_utc_time_range(form)
		lounge_ids = lounge_obj.search(self.cr, self.uid, [('date_order', '>=', date_start), ('date_order', '<=', date_end),
		                                             ('user_id', 'in', user_ids), ('company_id', '=', company_id)])

		for lounge in lounge_obj.browse(self.cr, self.uid, lounge_ids):
			for pol in lounge.lines:
				self.total_charge += pol.charge * pol.qty
		return self.total_charge or False

	def _paid_total_2(self):
		return self.total or 0.0

	def _total_of_the_day(self, objects):
		return self.total or 0.00

	def __init__(self, cr, uid, name, context):
		super(lounge_details, self).__init__(cr, uid, name, context=context)
		self.total = 0.0
		self.charge = 0.0
		self.qty = 0.0
		self.discount = 0.0
		self.total_discount = 0.0
		self.total_charge = 0.0
		self.total_invoiced = 0.0
		self.localcontext.update({
			'get_user_names': self._get_user_names,
			'time': time,
			'lounge_sales_details': self._lounge_sales_details,
			'gettaxamount': self._get_tax_amount,
			'getpayments': self._get_payments,
			'getsalestotal2': self._get_sales_total_2,
			'getqtytotal2': self._get_qty_total_2,
			'getsuminvoice2': self._get_sum_invoice_2,
			'getsumdisc': self._get_sum_discount,
			'getsumcharge': self._get_sum_charge,
			'getpaidtotal2': self._paid_total_2,
			'gettotaloftheday': self._total_of_the_day,
		})

class report_lounge_details(osv.AbstractModel):
	_name = 'report.point_of_lounge.report_details_of_sales'
	_inherit = 'report.abstract_report'
	_template = 'point_of_lounge.report_details_of_sales'
	_wrapped_report_class = lounge_details