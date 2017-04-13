# -*- coding: utf-8 -*-
from openerp import tools
from openerp.osv import fields, osv


class LoungeOrderReport(osv.osv):
    _name = "report.lounge.order"
    _description = "Lounge All Orders"
    _auto = False
    _order = 'booking_from_date asc'

    _columns = {
        'partner_id': fields.many2one('res.partner', 'Customer Name', readonly=True),
        'lounge_reference': fields.char(string='Track No', readonly=True),
        'date_order': fields.date(string='Order Date', readonly=True),
        'booking_from_date': fields.datetime(string='Booking From', readonly=True),
        'booking_to_date': fields.datetime(string='Booking To', readonly=True),
        'company_type': fields.char(string='Customer Type', readonly=True),
        'flight_type': fields.char(string='Flight Type', readonly=True),
        'flight_number': fields.char(string='Flight No', readonly=True),
        'service_01': fields.char(string='Service 1', readonly=True),
        'service_02': fields.char(string='Service 2', readonly=True),
        'service_03': fields.char(string='Service 3', readonly=True),
        'payment_method': fields.char(string='Type', readonly=True),
        'grandtotal': fields.float('Grand Total', readonly=True),
        'payment_name': fields.char('Payment', readonly=True),
        'total_pax': fields.integer('No.Pax', readonly=True),
    }

    _defaults = {
        'total_pax': 1
    }

    def init(self, cr):
        tools.drop_view_if_exists(cr, 'report_lounge_order')
        cr.execute("""
            CREATE OR REPLACE VIEW report_lounge_order AS (
                SELECT
                    MIN(lo.id) AS id,
                    lo.partner_id AS partner_id,
                    lo.lounge_reference AS lounge_reference,
                    to_char(date_order, 'dd/mm/YYYY') AS date_order,
                    lo.booking_from_date AS booking_from_date,
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
                    lo.state IN ('paid','invoice')
                GROUP BY
                    lo.id,rp.id,aj.id

            )
        """)
