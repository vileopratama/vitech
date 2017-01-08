# -*- coding: utf-8 -*-
{
    'name': "partner_contact_birthday",
    'summary': """
        Customer Field Birth Day
        birthday customer""",

    'description': """
        Added Field Birhday Customer
    """,

    'author': "Suhendar",
    'website': "http://www.vileo.co.id",

    # Categories can be used to filter modules in modules listing
    # Check https://github.com/odoo/odoo/blob/master/openerp/addons/base/module/module_data.xml
    # for the full list
    'category': 'Customer Relationship Management',
    'version': '0.1',

    # any module necessary for this one to work correctly
    'depends': ['base','partner_contact_personal_information_page'],

    # always loaded
    'data': [
        # 'security/ir.model.access.csv',
        'views/res_partner.xml',
        #'views/templates.xml',
    ],
    # only loaded in demonstration mode
    'demo': [
        #'demo/demo.xml',
    ],
}