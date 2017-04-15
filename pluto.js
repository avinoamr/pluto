(function() {
/**
 * PLUTO
 * Native HTML Template Rendering
 *
 *
 * The MIT License (MIT)
 * Copyright (c) 2013 Roi Avinoam
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
class Template extends HTMLTemplateElement {
    render(obj) {
        var compiled = this.compile()
        return new Renderer(compiled, compiled.items).render(obj)
    }

    compile() {
        var exprs = []
        var elements = [{ el: this.content, path: [] }]
        while (elements.length > 0) {
            var { el, path } = elements.shift()

            // inner content expressions
            if (el.nodeName === '#text') {
                var expr = isExpressions(el.textContent)
                if (expr) {
                    exprs.push({ expr, path })
                }
            }

            // attributes
            [].forEach.call(el.attributes || [], function(attr) {
                var expr = isExpressions(attr.value)
                if (expr !== null) {
                    attr = attr.name
                    var evName, prop
                    if (attr.startsWith('on-')) {
                        evName = attr.slice(3)
                    } else {
                        prop = snakeToCamelCase(attr)
                    }
                    exprs.push({ expr, path, attr, evName, prop })
                }
            }, this)

            // children, enqueue.
            el.childNodes.forEach(function(el, i) {
                maybeUpgrade(el)
                var subpath = path.concat(['childNodes', i])
                if (el instanceof Template) {
                    exprs.push({ path: subpath, tpl: true })
                    return
                }

                elements.push({ el, path: subpath })
            })
        }

        // remove attributes or expressions before rendering in order to hide
        // the placeholder expressions from the constructor of custom elements.
        var clone = this.cloneNode(true)
        exprs.forEach(function(expr) {
            var el = select(clone.content, expr.path)
            if (!expr.attr) {
                el.textContent = ''
            } else {
                el.removeAttribute(expr.attr)
            }
        }, this)

        var repeat = this.getAttribute('repeat') || this.getAttribute('for')
        if (repeat) {
            var fn = compileExpressions([{ expr: repeat }])
            clone.items = function(obj) {
                var items = fn(obj)[0] || []
                obj.__plutoElse = items.length > 0
                return items
            }
        }

        var cond = this.getAttribute('if')
        if (cond) {
            var fn = compileExpressions([{ expr: cond }])
            clone.items = (obj) => obj.__plutoElse = Boolean(fn(obj)[0])
        }

        var else_ = this.hasAttribute('else')
        if (else_) {
            clone.items = (obj) => obj.__plutoElse ? [] : [obj]
        }

        // we opt to compile the repeat/cond expressions separately than the
        // rest of this template - because (a) the template might relay on a
        // repeated ${item} property that doesn't yet exist in the repeat
        // expression, and (b) it's must smaller/faster than the complete
        // expressions list.
        // NB: It might not be that beneficial for cond though.
        clone.exprs = Object.assign(exprs, { eval: compileExpressions(exprs) })
        return clone
    }
}

class Renderer extends DocumentFragment {
    constructor(tpl, items) {
        super()
        this.tpl = tpl
        this.elements = []
        this.paths = {}
        this.exprs = tpl.exprs
        this.items = items

        if (items) {
            this.placeholder = document.createTextNode('')
            this.appendChild(this.placeholder)
        } else {
            this.appendChild(document.importNode(this.tpl.content, true))

            // copy the list of generated elements from the template in order
            // to support removals
            this.elements = [].map.call(this.childNodes, child => child)
        }
    }

    remove() {
        while (this.elements.length > 0) {
            this.elements.pop().remove()
        }
    }

    render(obj) {
        if (!this.items) {
            return this._renderOne(obj)
        }

        var items = this.items(obj)
        var item = obj.item
        if (!Array.isArray(items) && typeof items === 'object') {
            items = Object.keys(items).map(function(k) {
                return { key: k, value: items[k] }
            })
        }

        if (typeof items === 'boolean') {
            items = Number(items) // 0 or 1
        }

        if (typeof items === 'number') {
            items = new Array(items) // range-items, repeat N times.
            items = Array.from(items).map(() => item)
        }

        // remove obsolete items
        while (this.elements.length > items.length) {
            this.elements.pop().remove()
        }

        // update existing items
        for (var i = 0; i < this.elements.length; i += 1) {
            obj.item = items[i]
            this.elements[i].render(obj)
        }

        // create new items
        while (this.elements.length < items.length) {
            var i = this.elements.length
            obj.item = items[i]
            var doc = new Renderer(this.tpl).render(obj)
            this.elements.push(doc)
            this.placeholder.before(doc)
        }

        obj.item = item // restore previous item value.
        return this
    }

    _renderOne(obj) {
        var values = this.exprs.eval(obj)
        var subtpls = []
        for (var i = 0 ; i < this.exprs.length ; i += 1) {
            var expr = this.exprs[i]
            var v = values[i]
            var el = select(this, expr.path)

            // event handlers
            if (expr.evName) {
                if (typeof v === 'function') {
                    v = v._bound || v
                    el.addEventListener(expr.evName, v)
                }
            } else if (!expr.attr) {
                el.textContent = v || ''
            } else if (v === undefined) {
                el[expr.prop] = undefined
            } else {
                el[expr.prop] = v
                if (expr.attr === 'class' && typeof v === 'object') {
                    if (!Array.isArray(v)) {
                        v = Object.keys(v).filter(function (k) {
                            return v[k]
                        })
                    }

                    v = v.join(' ')
                } else if (expr.attr === 'style' && typeof v === 'object') {
                    v = Object.keys(v).map(function(k) {
                        return k + ': ' + v[k]
                    }).join('; ')
                }

                if (['class', 'style'].indexOf(expr.attr) !== -1) {
                    if (!v) {
                        el.removeAttribute(expr.attr)
                    } else {
                        el.setAttribute(expr.attr, v)
                    }
                }
            }

            // nested template
            if (expr.tpl) {
                subtpls.push(el)
            }
        }

        var else_ = obj.__plutoElse
        obj.__plutoElse = false
        for (var i = 0; i < subtpls.length; i += 1) {
            var el = subtpls[i]
            if (!el.render) {
                el.render = function(obj) {
                    delete el.render
                    var subdoc = pluto(this).render(obj)
                    this.replaceWith(subdoc)
                    this.render = subdoc.render.bind(subdoc)
                    this.remove = subdoc.remove.bind(subdoc)
                }
            }

            el.render(obj)
        }
        obj.__plutoElse = else_

        return this
    }
}

// -- HELPER FUNCTIONS

function maybeUpgrade(el) {
    // don't match #text, #comment, etc.
    if (el.nodeName[0] !== '#' && el.matches('template')) {
        pluto(el) // auto-upgrade nested templates.
    }
}

// Searches for an element from root based on the property-path to the child
// example: root = <body>, path = childNodes.3.childNode.7. Resolved by walking
// the path down to the child.
// NOTE that this function is memoized on the provided root object
function select(root, path) {
    var memo = root._plutoPaths || (root._plutoPaths = {})
    var pathKey = path.join('.')
    if (memo[pathKey]) {
        return memo[pathKey]
    }

    var el = root
    for (var i = 0; el !== undefined && i < path.length; i += 1) {
        el = el[path[i]]
    }

    return memo[pathKey] = el
}

const SNAKE_RE = /-([a-z])/g
function snakeToCamelCase(s) {
    return s.replace(SNAKE_RE, g => g[1].toUpperCase())
}

// extract expressions in template-literal syntax out of a string
var EXPR_RE = /\$\{[^\}]*\}/
function isExpressions(s) {
    return EXPR_RE.test(s) ? s : null
}

// compile a list of template-literal expressions into a function that evaluates
// these expression for the provided input object
function compileExpressions(exprs) {
    var refs = []
    var code = 'this.__plutoT || (this.__plutoT = T.bind(this));\n'
    code += exprs.map(function(expr, i) {
        if (expr.expr) {
            refs = refs.concat(getIdentifiers(expr.expr))
        }

        return `arguments[0][${i}] = this.__plutoT\`${expr.expr}\``
    }).join(';\n')

    var keys = refs.reduce((keys, k) => (keys[k] = true, keys), {})
    var locals = `var { ${Object.keys(keys)} } = this`
    var fn = eval('(function () {\n' + locals + '\n' + code + '\n})')
    return function(obj) {
        var res = []
        try {
            fn.call(obj, res)
        } catch (e) {
            console.warn(fn)
            throw e
        }

        return res
    }

    function T(s, v) {
        if (arguments.length > 2 || typeof v === 'string') {
            return String.raw.apply(null, arguments)
        }

        if (typeof v === 'function' && this[v.name] === v) {
            if (v._plutoBound !== this) {
                v._plutoBound = v.bind(this)
            }
            return v._plutoBound
        }

        return v
    }
}

// generate the list of identifiers found in the code.
function getIdentifiers(expr) {
    var re = /[$A-Z_][0-9A-Z_$]*/ig
    var whitespace = ' \n\r\t'
    var disallowed = '\'\".'
    var skip = ['true', 'false', 'if', 'for', 'while', 'do', 'try', 'catch',
        'break', 'continue', 'switch', 'throw', 'this', 'instanceof', 'in',
        'function', 'delete', 'default', 'case', 'debugger', 'const', 'var',
        'with', 'typeof', 'super', 'class', 'new', 'null', 'return', 'let',
        'import', 'else', 'enum', 'extends', 'finally', '$']

    // We first match for the valid identifier, and then check the previous
    // non-whitespace character preceeding the identifier to verify that it's
    // not a string or nested element.
    var refs = {}
    var match
    while (match = re.exec(expr)) {
        if (skip.indexOf(match[0]) !== -1) {
            continue // skipped or reserved keyword
        }

        if (window[match[0]] !== undefined) {
            continue // keep global functions (Object, Array, etc.)
        }

        var lastChar = undefined
        do {
            match.index -= 1
            if (whitespace.indexOf(expr[match.index]) === -1) {
                lastChar = expr[match.index]
            }
        } while (match.index > -1 && !lastChar)

        if (disallowed.indexOf(lastChar) === -1) {
            refs[match[0]] = true
        }
    }

    return Object.keys(refs)
}


// upgrade an element
// NOTE this will be unnecessary with customElements
function pluto(el) {
    if (typeof el === 'string') {
        // support HTML-imported selections
        var doc = document._currentScript // used by pollyfills
            || document.currentScript // native.
            || document // not an import.
        el = (doc.ownerDocument || doc).querySelector(el)
    }

    return !el || el instanceof Template
        ? el
        : Object.setPrototypeOf(el, Template.prototype)
}

pluto.Template = Template
pluto.RepeatRenderer = Renderer
window.pluto = pluto
})();

(function() {

    // placed here in order to have its own scope clear of any of the pluto
    // local variables.
    pluto._eval = function(code) {
        return eval(code)
    }
})();
