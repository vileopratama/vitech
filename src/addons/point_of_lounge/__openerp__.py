# -*- coding: utf-8 -*-
{
    'name': "Point Of Lounge",
    'summary': "Point of Lounge",
    'description': """Sale Up your """,
    'author': "Suhendar",
    'license': "AGPL-3",
    'website': "http://www.vileo.co.id",
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
        'point_of_lounge_data.xml',
        'report/lounge_order_report_view.xml',
        'point_of_lounge_sequence.xml',
        'point_of_lounge_workflow.xml',
        'account_statement_view.xml',
        'res_config_view.xml',
        'account_statement_view.xml',
        'views/report_receipt.xml',
        'views/templates.xml',
        'views/point_of_lounge.xml',
        'res_users_view.xml',
        'res_partner_view.xml',
        'point_of_lounge.xml',
        'point_of_lounge_dashboard.xml',
    ],
    'demo': [
        'point_of_lounge_demo.xml',
    ],
    'css' : [
        
    ],
    'installable': True,
    'application': True,
    'qweb': [
        'static/src/xml/lounge.xml'
    ],
    'auto_install': False,
}
