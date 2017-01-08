# -*- coding: utf-8 -*-
# Part of Odoo. See LICENSE file for full copyright and licensing details.
{
    'name': 'CRM Kubik Activiy ',
    'version': '1.0.0',
    'category': 'Sales',
    'sequence': 6,
    'summary': 'Leads, Opportunities, Activity',
    'description': "Activiy for Kubik CRM",
    'website': 'http://www.vileo.co.id',
    "author": "Suhendar",
    'depends': [
        'base','crm'
        #'base_action_rule',
        #'base_setup',
        #'sales_team',
        #'mail',
        #'calendar',
        #'resource',
        #'fetchmail',
        #'utm',
        #'web_tip',
        #'web_planner',
    ],
    'data': [
        'views/crm_activity.xml',
    ],
    'demo': [

    ],
    'test': [

    ],
    #'css': ['static/src/css/crm.css'],
    'installable': True,
    'application': False,
    'auto_install': False,
}