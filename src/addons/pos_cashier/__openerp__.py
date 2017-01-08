# -*- coding: utf-8 -*-
{
    'name': 'POS Cashiers',
    'version': '1.0.0',
    'category': 'Point Of Sale',
    'sequence': 3,
    'author': 'Suhendar',
    'summary': 'Manage cashiers for Point Of Sale',
    'description': " Manage several cashiers for each Point Of Sale",
    'depends': ["point_of_sale"],
    'data': [
        #'security/pos_cashier_security.xml',
        #'security/ir.model.access.csv',
        'pos_cashier_view.xml',
        #'order_cashier_view.xml',
    ],
    'js': [
        #'static/src/js/pos_cashier.js',
    ],
    'css': [
        #'static/src/css/pos_cashier.css',
    ],
    'qweb': [
        #'static/src/xml/pos_cashier.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
}