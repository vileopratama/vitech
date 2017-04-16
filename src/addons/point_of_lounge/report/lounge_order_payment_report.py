# -*- coding: utf-8 -*-
from openerp import tools
from openerp.osv import fields, osv


class LoungeOrderPaymentReport(osv.osv):
    _name = "report.lounge.order.payment"
    _description = "Lounge Payment Orders Analysist"
    _auto = False

    _columns = {
        'name': fields.char('Payment', readonly=True),
        'date_order': fields.datetime(string='Order Date', readonly=True),
        'count_payment': fields.integer('Total Payment', readonly=True),
    }

    _defaults = {
        'total_pax': 1
    }

    def init(self, cr):
        tools.drop_view_if_exists(cr, 'report_lounge_order_payment')
        cr.execute("""
            CREATE OR REPLACE VIEW report_lounge_order_payment AS (
                SELECT
                    MIN(aj.id) AS id,
                    lo.date_order AS date_order,
                    aj.name AS name,
                    COUNT(aj.id) AS count_payment
                FROM
                    lounge_order AS lo
                LEFT JOIN
                    res_partner AS rp ON rp.id = lo.partner_id
                INNER JOIN
                    account_bank_statement_line AS absl ON absl.lounge_statement_id = lo.id
                INNER JOIN
                    account_journal AS aj ON aj.id = absl.journal_id
                WHERE
                    lo.state IN ('paid','invoice')
                GROUP BY
                   aj.id,lo.date_order
            )
        """)
