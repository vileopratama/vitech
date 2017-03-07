# -*- coding: utf-8 -*-
from openerp.osv import osv, fields


class ResPartnerGroup(osv.osv):
    _name = 'res.partner.group'
    _columns = {
        'name': fields.char(string='Group Name', size=100,required=True),
        'description': fields.text(string='Description', size=255),
        'state': fields.selection([('active', 'Active'),
                                   ('inactive', 'Inactive'),
                                   ], 'Status', readonly=True, copy=False),
    }

    _defaults = {
        'state': 'active'
    }
