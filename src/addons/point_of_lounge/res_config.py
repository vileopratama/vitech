from openerp.osv import fields, osv

class pos_configuration(osv.TransientModel):
    _name = 'lounge.config.settings'
    _inherit = 'res.config.settings'
    _columns = {
        'module_pos_discount': fields.selection([
            (0, "Allow discounts on order lines only"),
            (1, "Allow global discounts")
        ], "Discount",
            help='Allows the cashier to  sale discount for all the sales to a customer'),
        'module_pos_reprint': fields.selection([
            (0, "No reprint"),
            (1, "Allow cashier to reprint receipts")
        ], "Reprints"),
    }

"""
*   For a field like 'default_XXX', ``execute`` sets the (global) default value of
    the field 'XXX' in the model named by ``default_model`` to the field's value.

*   For a boolean field like 'group_XXX', ``execute`` adds/removes 'implied_group'
    to/from the implied groups of 'group', depending on the field's value.
    By default 'group' is the group Employee.  Groups are given by their xml id.

*   For a boolean field like 'module_XXX', ``execute`` triggers the immediate
    installation of the module named 'XXX' if the field has value ``True``.

*   For the other fields, the method ``execute`` invokes all methods with a name
    that starts with 'set_'; such methods can be defined to implement the effect
    of those fields.

The method ``default_get`` retrieves values that reflect the current status of the
fields like 'default_XXX', 'group_XXX' and 'module_XXX'.  It also invokes all methods
with a name that starts with 'get_default_'; such methods can be defined to provide
current values for other fields.
    """










