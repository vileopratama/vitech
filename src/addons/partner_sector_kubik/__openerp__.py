{
    "name": "Kubik CRM Customer Sector Setting",
    "summary": "Add customer sector to kubik contacts",
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
        "base",
    ],
    "data": [
        "views/res_partner_sector.xml",
        "views/res_partner.xml"
    ],

}
