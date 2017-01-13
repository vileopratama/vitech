# -*- coding: utf-8 -*-
{
    'name': "Point Of Lounge",
    'summary': "Short subtitle phrase",
    'description': """Long description""",
    'author': "Your name",
    'license': "AGPL-3",
    'website': "http://www.example.com",
    'category': 'Sales',
    'version': '9.0.1.0.0',
    'depends': ['sale_stock', 'barcodes'],
    'data': [
        'wizard/lounge_box.xml',
        'point_of_lounge_view.xml',
        'point_of_lounge_dashboard.xml',
        'res_config_view.xml',
        'account_statement_view.xml',
    ],
    'demo': [
        #'demo.xml'
    ],
    'installable': True,
    'application': True,
    'auto_install': False,
}