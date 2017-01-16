from openerp.osv import osv
from openerp.exceptions import UserError
from openerp.tools.translate import _
from openerp import SUPERUSER_ID

class LoungeInvoiceReport(osv.AbstractModel):
    _name = 'report.point_of_lounge.report_invoice'

    def render_html(self, cr, uid, ids, data=None, context=None):
        report_obj = self.pool['report']
        loungeorder_obj = self.pool['lounge.order']
        report = report_obj._get_report_from_name(cr, uid, 'account.report_invoice')
        selected_orders = loungeorder_obj.browse(cr, uid, ids, context=context)
        ids_to_print = []
        invoiced_posorders_ids = []
        for order in selected_orders:
            if order.invoice_id:
                ids_to_print.append(order.invoice_id.id)
                invoiced_posorders_ids.append(order.id)

        not_invoiced_orders_ids = list(set(ids) - set(invoiced_posorders_ids))
        if not_invoiced_orders_ids:
            not_invoiced_loungeorders = loungeorder_obj.browse(cr, uid, not_invoiced_orders_ids, context=context)
            not_invoiced_orders_names = list(map(lambda a: a.name, not_invoiced_loungeorders))
            raise UserError(_('No link to an invoice for %s.') % ', '.join(not_invoiced_orders_names))

        docargs = {
            'docs': self.pool['account.invoice'].browse(cr, uid, ids_to_print, context=context)
        }

        return report_obj.render(cr, SUPERUSER_ID, ids, 'account.report_invoice', docargs, context=context)





