# -*- coding: utf-8 -*-
from openerp.osv import fields, osv

class account_journal(osv.osv):
    _inherit = 'account.journal'
    _columns = {
        'journal_user': fields.boolean('Active in Lounge', help="Check this box if this journal define a payment method that can be used in a point of sale."),
        'amount_authorized_diff' : fields.float('Amount Authorized Difference', help="This field depicts the maximum difference allowed between the ending balance and the theoretical cash when closing a session, for non-POS managers. If this maximum is reached, the user will have an error message at the closing of his session saying that he needs to contact his manager."),
    }

class account_lounge_bank_statement(osv.osv):
    _inherit = 'account.bank.statement'
    _columns = {
        'lounge_session_id' : fields.many2one('lounge.session', string="Session", copy=False),
        'account_id': fields.related('journal_id', 'default_debit_account_id', type='many2one',
                                     relation='account.account', readonly=True),
    }
