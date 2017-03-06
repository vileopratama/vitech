# -*- coding: utf-8 -*-
from openerp.addons.report_xlsx.report.report_xlsx import ReportXlsx


class LoungeOrderXlsx(ReportXlsx):
    def generate_xlsx_report(self, workbook, data, orders):
        for obj in orders:
            report_name = obj.lounge_reference
            # One sheet by partner
            sheet = workbook.add_worksheet(report_name[:31])
            bold = workbook.add_format({'bold': True})
            sheet.write(0, 0, obj.name, bold)


LoungeOrderXlsx('report.lounge.order.xlsx',
                'lounge.order')
