from openerp.addons.account.wizard.pos_box import CashBox
from openerp.exceptions import UserError
from openerp.tools.translate import _

#main class
class LoungeBox(CashBox):
    _register = False

    def run(self, cr, uid, ids, context=None):
        if not context:
            context = dict()

        active_model = context.get('active_model', False) or False
        active_ids = context.get('active_ids', []) or []

        if active_model == 'lounge.session':
            records = self.pool[active_model].browse(cr, uid, active_ids, context=context)
            bank_statements = [record.cash_register_id for record in records if record.cash_register_id]

            if not bank_statements:
                raise UserError(_("There is no cash register for this Lounge Session"))

            return self._run(cr, uid, ids, bank_statements, context=context)
        else:
            return super(LoungeBox, self).run(cr, uid, ids, context=context)

#child class
class LoungeBoxIn(LoungeBox):
    _inherit = 'cash.box.in'

    def _calculate_values_for_statement_line(self, cr, uid, id, record, context=None):
        if context is None:
            context = {}
        values = super(LoungeBoxIn, self)._calculate_values_for_statement_line(cr, uid, id, record, context=context)[0]
        active_model = context.get('active_model', False) or False
        active_ids = context.get('active_ids', []) or []

        if active_model == 'lounge.session':
            session = self.pool[active_model].browse(cr, uid, active_ids, context=context)[0]
            values['ref'] = session.name
        return values

#child class
class LoungeBoxOut(LoungeBox):
    _inherit = 'cash.box.out'
    def _calculate_values_for_statement_line(self, cr, uid, id, record, context=None):
        values = super(LoungeBoxOut, self)._calculate_values_for_statement_line(cr, uid, id, record, context=context)[0]

        active_model = context.get('active_model', False) or False
        active_ids = context.get('active_ids', []) or []

        if active_model == 'lounge.session':
            session = self.pool[active_model].browse(cr, uid, active_ids, context=context)[0]
            values['ref'] = session.name
        return values