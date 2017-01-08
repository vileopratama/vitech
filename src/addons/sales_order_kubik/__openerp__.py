{
    "name": "Kubik Sales Order (Job Order)",
    "summary": "Add custom field to Kubik JOB ORDER",
    "version": "9.0.1.1.0",
    "category": "Sales",
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
        "base","product","sale"
    ],
    "data": [
        "views/sale_view.xml",
    ],

}
