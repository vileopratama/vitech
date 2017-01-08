# -*- coding: utf-8 -*-
from openerp import http

# class PartnerContactBirthday(http.Controller):
#     @http.route('/partner_contact_birthday/partner_contact_birthday/', auth='public')
#     def index(self, **kw):
#         return "Hello, world"

#     @http.route('/partner_contact_birthday/partner_contact_birthday/objects/', auth='public')
#     def list(self, **kw):
#         return http.request.render('partner_contact_birthday.listing', {
#             'root': '/partner_contact_birthday/partner_contact_birthday',
#             'objects': http.request.env['partner_contact_birthday.partner_contact_birthday'].search([]),
#         })

#     @http.route('/partner_contact_birthday/partner_contact_birthday/objects/<model("partner_contact_birthday.partner_contact_birthday"):obj>/', auth='public')
#     def object(self, obj, **kw):
#         return http.request.render('partner_contact_birthday.object', {
#             'object': obj
#         })