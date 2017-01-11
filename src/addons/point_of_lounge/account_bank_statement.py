# -*- coding: utf-8 -*-
from openerp.osv import fields, osv

#class account_bank_statement(osv.osv):
    #_inherit = 'account.bank.statement'
    #_columns = {
        #'lounge_session_id' : fields.many2one('lounge.session', string="Session", copy=False),
        #'account_id': fields.related('journal_id', 'default_debit_account_id', type='many2one', relation='account.account', readonly=True),
    #}