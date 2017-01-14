# -*- coding: utf-8 -*-

import time
from openerp.osv import osv, fields
from openerp.tools.translate import _

class account_journal(osv.osv):
    _inherit = 'account.journal'

    def search(self, cr, uid, args, offset=0, limit=None, order=None, context=None, count=False):
        if not context:
            context = {}
        session_id = context.get('lounge_session_id', False) or False

        if session_id:
            session = self.pool.get('lounge.session').browse(cr, uid, session_id, context=context)

            if session:
                journal_ids = [journal.id for journal in session.config_id.journal_ids]
                args += [('id', 'in', journal_ids)]

        return super(account_journal, self).search(cr, uid, args, offset=offset, limit=limit, order=order, context=context, count=count)

#make payment
class lounge_make_payment(osv.osv_memory):
    _name = 'lounge.make.payment'
    _description = 'Lounge Payment'

    def check(self, cr, uid, ids, context=None):
        """
        Check the order:
        if the order is not paid: continue payment,
        if the order is paid print ticket.
        """
        context = context or {}
        order_obj = self.pool.get('lounge.order')
        active_id = context and context.get('active_id', False)
        order = order_obj.browse(cr, uid, active_id, context=context)
        amount = order.amount_total - order.amount_paid
        data = self.read(cr, uid, ids, context=context)[0]
        # this is probably a problem of osv_memory as it's not compatible with normal OSV's
        data['journal'] = data['journal_id'][0]

        if amount != 0.0:
            order_obj.add_payment(cr, uid, active_id, data, context=context)

        if order_obj.test_paid(cr, uid, [active_id]):
            order_obj.signal_workflow(cr, uid, [active_id], 'paid')
            return {'type': 'ir.actions.act_window_close'}

        return self.launch_payment(cr, uid, ids, context=context)

    def launch_payment(self, cr, uid, ids, context=None):
        return {
            'name': _('Payment'),
            'view_type': 'form',
            'view_mode': 'form',
            'res_model': 'lounge.make.payment',
            'view_id': False,
            'target': 'new',
            'views': False,
            'type': 'ir.actions.act_window',
            'context': context,
        }

    def _default_journal(self, cr, uid, context=None):
        if not context:
            context = {}
        session = False
        order_obj = self.pool.get('lounge.order')
        active_id = context and context.get('active_id', False)
        if active_id:
            order = order_obj.browse(cr, uid, active_id, context=context)
            session = order.session_id
        if session:
            for journal in session.config_id.journal_ids:
                return journal.id

        return False

    def _default_amount(self, cr, uid, context=None):
        order_obj = self.pool.get('lounge.order')
        active_id = context and context.get('active_id', False)
        if active_id:
            order = order_obj.browse(cr, uid, active_id, context=context)
            return order.amount_total - order.amount_paid

        return False

    _columns = {
        'journal_id': fields.many2one('account.journal', 'Payment Mode', required=True),
        'amount': fields.float('Amount', digits=(16, 2), required=True),
        'payment_name': fields.char('Payment Reference'),
        'payment_date': fields.date('Payment Date', required=True),
    }

    _defaults = {
        'journal_id': _default_journal,
        'payment_date': lambda *a: time.strftime('%Y-%m-%d %H:%M:%S'),
        'amount': _default_amount,
    }

