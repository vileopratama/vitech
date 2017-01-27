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
            timestamp = datetime.datetime.strptime(form[date_field] + ' 00:00:00', tools.DEFAULT_SERVER_DATETIME_FORMAT) + datetime.timedelta(**delta)
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
		    'charge' : pol.charge,
		    'qty': pol.qty,
		    'discount': pol.discount,
		    'total': ((pol.price_unit * pol.qty * (1 - (pol.discount) / 100.0)) + (pol.charge * pol.qty)),
		    'date_order': lounge.date_order,
		    'lounge_name': lounge.name,
		    'uom': pol.product_id.uom_id.name
		}
				
		data.append(result)
		self.charge+=result['charge']
		self.qty += result['qty']
		self.discount += result['discount']
	    self.total += lounge.amount_total
		
	if data:
	    return data
	else:
            return {}
				    
    def __init__(self, cr, uid, name, context):
	super(lounge_details, self).__init__(cr, uid, name, context=context)
	self.localcontext.update({
	    'get_user_names': self._get_user_names,
	    'time': time,
	    'lounge_sales_details': self._lounge_sales_details,
	})

class report_lounge_details(osv.AbstractModel):
    _name = 'report.point_of_lounge.report_details_of_sales'
    _inherit = 'report.abstract_report'
    _template = 'point_of_lounge.report_details_of_sales'
    _wrapped_report_class = lounge_details
