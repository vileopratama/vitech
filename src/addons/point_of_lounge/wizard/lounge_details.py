# -*- coding: utf-8 -*-
import time
from openerp.osv import osv, fields

class lounge_details(osv.osv_memory):
	_name = 'lounge.details'
	_description = 'Sales Details'
	
	_columns = {
		'date_start': fields.date('Date Start', required=True),
		'date_end': fields.date('Date End', required=True),
		'user_ids': fields.many2many('res.users', 'lounge_details_report_user_rel', 'user_id', 'wizard_id', 'Salespeople'),
	}
	
	_defaults = {
		'date_start': fields.date.context_today,
		'date_end': fields.date.context_today,
	}
	
	def print_report(self, cr, uid, ids, context=None):
		"""
		To get the date and print the report
		@param self: The object pointer.
		@param cr: A database cursor
		@param uid: ID of the user currently logged in
		@param context: A standard dictionary
		@return : retrun report
		"""
		if context is None:
			context = {}
		datas = {'ids': context.get('active_ids', [])}
		res = self.read(cr, uid, ids, ['date_start', 'date_end', 'user_ids'], context=context)
		res = res and res[0] or {}
		datas['form'] = res
		if res.get('id', False):
			datas['ids'] = [res['id']]
		return self.pool['report'].get_action(cr, uid, [], 'point_of_lounge.report_details_of_sales', data =datas,context=context)
	