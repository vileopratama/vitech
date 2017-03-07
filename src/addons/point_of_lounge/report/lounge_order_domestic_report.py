# -*- coding: utf-8 -*-
from openerp import tools
from openerp.osv import fields, osv


class LoungeOrderDomesticReport(osv.osv):
    _name = "report.lounge.order.domestic"
    _description = "Lounge Orders Domestic"
    _auto = False
    _order = 'partner_id asc'

    _columns = {
        'partner_id': fields.many2one('res.partner', 'Customer Name', readonly=True),
        'lounge_reference': fields.char(string='Track No', readonly=True),
        'booking_from_date': fields.datetime(string='Booking From', readonly=False),
        'booking_to_date': fields.datetime(string='Booking To', readonly=False),
        'company_type': fields.char(string='Customer Type', readonly=False),
    }

    def init(self, cr):
        tools.drop_view_if_exists(cr, 'report_lounge_order_domestic')
        cr.execute("""
            CREATE OR REPLACE VIEW report_lounge_order_domestic AS (
                SELECT
                lo.id AS id,
                lo.partner_id AS partner_id,
                lo.lounge_reference AS lounge_reference,
                lo.booking_from_date AS booking_from_date,
                lo.booking_to_date AS booking_to_date,
                CASE WHEN rp.company_type='company' THEN 'Company' ELSE 'Individual' END AS company_type
                FROM lounge_order AS lo
                LEFT JOIN res_partner rp ON rp.id = lo.partner_id
            )
        """)
