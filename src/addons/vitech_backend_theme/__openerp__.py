{
    'name' : 'Vitech Backend Theme for Odoo 9c',
    'version' : '0.3',
    'author' : 'Vileo Pratama Teknologi',
    'category' : 'Website',
    'summary': 'Clean Theme for Odoo 9c',
    'website' : 'http://www.vileo.co.id',
    'description': """
Clean Theme Odoo 9c for Vitech ERP, based on Bootstrap United template. The theme also custom every time from bugs.
    """,
    'images':[
        'images/sales.png'
    ],
    'depends' : ['base'],
    'data':[
        'data/ir_config_parameter.xml',
        'views/views.xml',
        'views/website_template.xml',
        'views/webclient_template.xml',
    ],
    'installable': True,
    'application': True,
}
