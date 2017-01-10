# -*- coding: utf-8 -*-

{
    'name': 'Point of Lounge',
    'version': '1.0.1',
    'category': 'Point Of Lounge',
    'sequence': 20,
    'summary': 'Touchscreen Interface for Lounge',
    'description': """
Quick and Easy sale process
===========================

This module allows you to manage your shop sales very easily with a fully web based touchscreen interface.
It is compatible with all PC tablets and the iPad, offering multiple payment methods.

Product selection can be done in several ways:

* Using a barcode reader
* Browsing through categories of products or via a text search.

Main Features
-------------
* Fast encoding of the sale
* Choose one payment method (the quick way) or split the payment between several payment methods
* Computation of the amount of money to return
* Create and confirm the picking list automatically
* Allows the user to create an invoice automatically
* Refund previous sales
    """,
    'depends': [

    ],
    'data': [
        'point_of_lounge_view.xml',
    ],
    'demo': [

    ],
    'test': [

    ],
    'installable': True,
    'application': True,
    #'qweb': ['static/src/xml/pos.xml'],
    'website': 'https://www.vileo.co.id',
    'auto_install': False,
}
