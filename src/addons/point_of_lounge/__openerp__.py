# -*- coding: utf-8 -*-
{
    'name': "Point Of Lounge",
    'summary': "Short subtitle phrase",
    'description': """Long description""",
    'author': "Suhendar",
    'license': "AGPL-3",
    'website': "http://www.example.com",
    'category': 'Sales',
    'version': '9.0.1.0.0',
    'depends': ['sale_stock', 'barcodes'],
    'data': [
        'data/report_paperformat.xml',
        'module/module_data.xml',
        'security/point_of_lounge_security.xml',
        'security/ir.model.access.csv',
        'wizard/lounge_box.xml',
        'wizard/lounge_payment.xml',
        'point_of_lounge_report.xml',
        'point_of_lounge_view.xml',
        #'point_of_lounge_data.xml',
        'point_of_lounge_workflow.xml',
        'res_config_view.xml',
        'account_statement_view.xml',
        'views/report_receipt.xml',
        'views/templates.xml',
        'views/point_of_lounge.xml',
        'res_users_view.xml',
        'point_of_lounge.xml',
        'point_of_lounge_dashboard.xml',
    ],
    'demo': [
        #'demo.xml'
    ],
    'installable': True,
    'application': True,
    'qweb': [
        'static/src/xml/lounge.xml'
    ],
    'auto_install': False,
}