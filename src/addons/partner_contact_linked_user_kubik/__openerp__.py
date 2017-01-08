{
    "name": "Kubik CRM Customer User Linked",
    "summary": "Add customer linked user to kubik contacts",
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
        "base","crm",
    ],
    "data": [
        "views/tab_page_linked_user.xml",
        "views/res_partner.xml"
    ],

}
