{
    "name": "Other Customer Information Customer Priority",
    "summary": "Add customer priority field to contacts",
    "version": "9.0.1.1.0",
    "category": "Customer Relationship Management",
    "website": "http://vileo.co.id",
    "author": "Suhendar",
    "contributors": [
        'Suhendar',
    ],
    "license": "AGPL-3",
    'application': False,
    'installable': True,
    'auto_install': False,
    "depends": [
        "partner_contact_other_information_page",
    ],
    "data": [
        "views/res_partner.xml",
    ],
    #'post_init_hook': 'post_init_hook',
}
