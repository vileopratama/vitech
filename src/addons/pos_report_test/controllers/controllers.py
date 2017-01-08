# -*- coding: utf-8 -*-
from openerp import http

# class PosReportTest(http.Controller):
#     @http.route('/pos_report_test/pos_report_test/', auth='public')
#     def index(self, **kw):
#         return "Hello, world"

#     @http.route('/pos_report_test/pos_report_test/objects/', auth='public')
#     def list(self, **kw):
#         return http.request.render('pos_report_test.listing', {
#             'root': '/pos_report_test/pos_report_test',
#             'objects': http.request.env['pos_report_test.pos_report_test'].search([]),
#         })

#     @http.route('/pos_report_test/pos_report_test/objects/<model("pos_report_test.pos_report_test"):obj>/', auth='public')
#     def object(self, obj, **kw):
#         return http.request.render('pos_report_test.object', {
#             'object': obj
#         })