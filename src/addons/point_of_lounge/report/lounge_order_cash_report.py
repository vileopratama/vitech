# -*- coding: utf-8 -*-
from openerp import tools
from openerp.osv import fields, osv


class LoungeOrderDomesticReport(osv.osv):
    _name = "report.lounge.order.cash"
    _description = "Lounge Orders cash"
    _auto = False
    _order = 'booking_from_date asc'

    _columns = {
        'partner_id': fields.many2one('res.partner', 'Customer Name', readonly=True),
        'lounge_reference': fields.char(string='Track No', readonly=True),
        'booking_from_date': fields.datetime(string='Booking From', readonly=False),
        'booking_to_date': fields.datetime(string='Booking To', readonly=False),
        'company_type': fields.char(string='Customer Type', readonly=False),
        'flight_type': fields.char(string='Flight Type', readonly=False),
        'flight_number': fields.char(string='Flight No', readonly=False),
        'service_01': fields.char(string='Service 1', readonly=False),
        'service_02': fields.char(string='Service 2', readonly=False),
        'service_03': fields.char(string='Service 3', readonly=False),
        'payment_method': fields.char(string='Type', readonly=False),
        'grandtotal': fields.float('Grand Total', readonly=True),
        'payment_name': fields.char('Payment', readonly=True),
        'total_pax': fields.integer('No.Pax', readonly=True),
    }

    _defaults = {
        'total_pax': 1
    }

    def init(self, cr):
        tools.drop_view_if_exists(cr, 'report_lounge_order_cash')
        cr.execute("""
            CREATE OR REPLACE VIEW report_lounge_order_cash AS (
                SELECT
                    MIN(lo.id) AS id,
                    lo.partner_id AS partner_id,
                    lo.lounge_reference AS lounge_reference,
                    lo.booking_from_date AS booking_from_date,
                    lo.booking_to_date AS booking_to_date,
                    CASE WHEN rp.company_type='company' THEN 'Company' ELSE 'Individual' END AS company_type,
                    CASE WHEN lo.flight_type='international' THEN 'International' ELSE 'Domestic' END AS flight_type,
                    lo.flight_number AS flight_number,
                    lo.service_01 as service_01,
                    lo.service_02 as service_02,
                    lo.service_03 as service_03,
                    CASE WHEN aj.type='cash' THEN 'Cash' ELSE 'Card' END AS payment_method,
                    SUM(absl.amount) as grandtotal,
                    aj.name AS payment_name,
                    lo.total_pax AS total_pax
                FROM
                    lounge_order AS lo
                LEFT JOIN
                    res_partner AS rp ON rp.id = lo.partner_id
                LEFT JOIN
                    account_bank_statement_line AS absl ON absl.lounge_statement_id = lo.id
                LEFT JOIN
                    account_journal AS aj ON aj.id = absl.journal_id
                WHERE
                    lo.state IN ('paid','invoice') AND aj.type='cash'
                GROUP BY
                    lo.id,rp.id,aj.id
            )
        """)
