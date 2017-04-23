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
        return this.compile()(obj)
    }

    compile() {
        var content = this.content.cloneNode(true)
        var exprs = []
        var elements = [{ el: content, path: [] }]
        while (elements.length > 0) {
            var { el, path } = elements.shift()

            Template.modules.forEach((m) => m(el, path, exprs))

            var attrs = el.attributes || [];
            if (el.nodeName === '#text') {
                attrs.push({ name: 'textContent', value: el.textContent })
            }

            for (var attr of attrs) {
                var expr = isExpressions(attr.value)
                if (expr === null) {
                    continue
                }

                exprs.push({ expr, path, prop: snakeToCamelCase(attr.name) })
            }

            // enqueue children
            el.childNodes.forEach(function(el, i) {
                elements.push({ el, path: path.concat(['childNodes', i]) })
            })
        }

        exprs = Object.assign(exprs, { eval: compileExpressions(exprs) })
        return function (obj) {
            var doc = document.importNode(content, true)
            var elements = Array.from(doc.childNodes).map(child => child)
            var paths = exprs.map(expr => select(doc, expr.path))

            doc.render = function(obj) {
                var values = exprs.eval(obj)
                for (var i = 0 ; i < exprs.length ; i += 1) {
                    var expr = exprs[i]
                    var el = paths[i]
                    expr.render
                        ? expr.render(el, values[i], obj)
                        : (el[expr.prop] = values[i])
                }
                return this
            }

            doc.remove = function() {
                while (elements.length > 0) {
                    elements.pop().remove()
                }
            }

            return doc.render(obj)
        }
    }

    _renderItems(items, obj) {
        if (!this._placeholder) {
            this._placeholder = document.createTextNode('')
            this.replaceWith(this._placeholder)
            this.__items = []
        }
        this.obj = obj

        if (typeof items === 'object' && !Array.isArray(items)) {
            items = Object.keys(items).map(function(k) {
                return { key: k, value: items[k] }
            })
        } else if (typeof items === 'boolean') {
            items = items ? [this.obj.item] : [] // 0 or 1
        } else if (typeof items === 'number') {
            items = new Array(items) // range-items, repeat N times.
            items = Array.from(items).map(() => this.obj.item)
        }

        // remove obsolete items
        while (this.__items.length > items.length) {
            this.__items.pop().remove()
        }

        // update existing items
        for (var i = 0; i < this.__items.length; i += 1) {
            this.obj.item = items[i]
            this.__items[i].render(this.obj)
        }

        // create new items
        while (this.__items.length < items.length) {
            var i = this.__items.length
            this.obj.item = items[i]
            var doc = this.compile()(obj)
            this.__items.push(doc)
            this._placeholder.before(doc)
        }
    }

    remove() {
        while (this.__items && this.__items.length > 0) {
            this.__items.pop().remove()
        }

        this.constructor.prototype.remove.apply(this, arguments)
    }

    static get modules() {
        return this._modules || (this._modules = [])
    }

    static addModule(compileFn) {
        this.modules.push(compileFn)
    }
}


// -- MODULES / EXTENSIONS

// CLASS
// class attributes behave differently because:
//  1. we can't assign `el.class = value`. We need className
//  2. we want to transform objects/arrays to text strings
Template.addModule(function compileClass(el, path, exprs) {
    var expr = el.getAttribute && isExpressions(el.getAttribute('class'))
    if (!expr) {
        return
    }

    el.removeAttribute('class')
    exprs.push({ expr, path, render })

    function render(el, v) {
        if (typeof v === 'object') {
            if (!Array.isArray(v)) {
                v = Object.keys(v).filter((k) => v[k])
            }

            v = v.join(' ')
        }

        el.className = v
    }
})

// STYLE
// style attributes behave differently because we can't just assign
//     `el.style = value`
Template.addModule(function compileStyle(el, path, exprs) {
    var expr = el.getAttribute && isExpressions(el.getAttribute('style'))
    if (!expr) {
        return
    }

    el.removeAttribute('style')
    exprs.push({ expr, path, render })

    function render(el, v) {
        typeof v === 'object'
            ? Object.assign(el.style, v)
            : el.setAttribute('style', v)
    }
})

// ELSE-IF
Template.addModule(function compileElseIf(el) {
    var expr = el.getAttribute && isExpressions(el.getAttribute('else-if'))
    if (!expr) {
        return
    }

    el.removeAttribute('else-if')
    el.setAttribute('else', '')
    el.setAttribute('if', expr)
})

// ELSE
Template.addModule(function compileElse(el) {
    if (!el.hasAttribute || !el.hasAttribute('else')) {
        return
    }

    el.removeAttribute('else')
    el._elseExpr = true
    el.attributes.repeat || el.setAttribute('repeat', '')
})


// IF
Template.addModule(function compileIf(el, path, exprs) {
    var expr = el.getAttribute && isExpressions(el.getAttribute('if'))
    if (!expr) {
        return
    }

    el.removeAttribute('if')
    el._ifExpr = expr
    el.attributes.repeat || el.setAttribute('repeat', '')
})


// REPEAT / IF / ELSE-IF / ELSE
Template.addModule(function compileRepeat(el, path, exprs) {
    var repeatExpr = el.getAttribute && isExpressions(el.getAttribute('repeat'))
    var ifExpr = el._ifExpr
    var elseExpr = el._elseExpr
    if (!repeatExpr && !ifExpr && !elseExpr) {
        return
    }

    var repeatFn = repeatExpr
        ? compileExpressions([{ expr: repeatExpr }])
        : function(obj) { return [[obj.item]] }

    var ifFn = ifExpr
        ? compileExpressions([{ expr: ifExpr }])
        : function () { return [true] }


    // main expression is either the repeat or if (or 'true' for else.)
    var expr = '${1}'

    el.removeAttribute('repeat')
    rewire(el)

    exprs.push({ expr, path, render })
    function render(el, items, obj) {
        var items = repeatFn(obj)[0]
        items = items.filter(function (item) {
            obj.item = item
            return ifFn(obj)[0]
        })

        pluto(el)._renderItems(items, obj)
    }
})


function rewire(el) {
    // Repeated items must be templates. Otherwise - coerce it into a template
    // by creating a new template with the content of the input element
    var clone = el.cloneNode(true)
    if (clone.localName !== 'template') {
        var tpl = document.createElement('template')//new Template()
        tpl.content.appendChild(clone)
        clone = tpl
    }

    // replace the element with the repeated node, and stop the compilation
    // loop for this element by emptying it.
    el.replaceWith(clone)
    while (el.attributes.length > 0) {
        el.removeAttribute(el.attributes[0].name)
    }
    el.innerHTML = ''

    return clone
}





class Templatex extends HTMLTemplateElement {
    render(obj) {
        var compiled = this._compiled || (this._compiled = {})
        if (compiled.html !== this.innerHTML) { // recompile
            // console.log('RECOMPILE', this) // bad - nested cloned templates are re-compiled on every item
            Object.assign(compiled, this.compile(this.content), {
                html: this.innerHTML
            })
        }

        var { content, exprs, items } = compiled
        return new Renderer(content, exprs, items).render(obj)
    }

    compile(content) {
        // first clone the compiled template as this compilation process is
        // free to modify the DOM without causing these changes to be reflected
        // externally
        var doc = new DocumentFragment()
        doc.appendChild(content.cloneNode(true))
        content = doc

        var exprs = []
        var elements = [{ el: content, path: [] }]
        while (elements.length > 0) {
            var { el, path } = elements.shift()

            exprs = exprs.concat(this._compileEl(el, path))

            // enqueue children
            el.childNodes.forEach(function(el, i) {
                elements.push({ el, path: path.concat(['childNodes', i]) })
            })
        }

        // we opt to compile the repeat/cond expressions separately than the
        // rest of this template - because (a) the template might relay on a
        // repeated ${item} property that doesn't yet exist in the repeat
        // expression, and (b) it's must smaller/faster than the complete
        // expressions list.
        // NB: It might not be that beneficial for cond though.
        exprs = Object.assign(exprs, { eval: compileExpressions(exprs) })
        return { content, exprs }
    }

    _compileEl(el, path) {
        var exprs = []

        // inner content expressions
        if (el.nodeName === '#text') {
            var expr = isExpressions(el.textContent)
            if (expr) {
                el.textContent = ''
                var render = (el, v) => (el.textContent = v || '')
                exprs.push({ expr, path, render })
            }
        }

        var directives = [
            { attr: 'else', fn: RepeatedNode._renderElse },
            { attr: 'if', fn: this._renderIf },
            { attr: 'repeat', fn: this._renderRepeat }
        ]

        // handle all directives
        var attrs = el.attributes || []
        for (var directive of directives) {
            var attr = attrs[directive.attr]
            if (!attr) {
                continue
            }

            var render = directive.fn.call(this, el)
            if (!render) {
                continue
            }

            el.removeAttribute(directive.attr)
            var expr = isExpressions(attr.value)
            exprs.push({ expr, path, render })
        }

        // remaining attributes
        for (var attr of el.attributes || []) {
            var expr = isExpressions(attr.value)
            if (expr === null) {
                continue
            }

            attr = attr.name
            el.removeAttribute(attr)
            if (attr.startsWith('on-')) {
                var render = this._renderEvent(attr.slice(3)) // trim 'on-'
            } else {
                var render = this._renderProp(snakeToCamelCase(attr))
            }

            exprs.push({ expr, path, render })
        }

        return exprs
    }

    _renderProp(prop) {
        return (el, v) => el[prop] = v
    }

    _renderClass() {
        return function(el, v) {
            if (typeof v === 'object') {
                if (!Array.isArray(v)) {
                    v = Object.keys(v).filter((k) => v[k])
                }

                return v.join(' ')
            }

            el.className = v
        }
    }

    _renderStyle() {
        return (el, v) => typeof v === 'object'
            ? Object.assign(el.style, v)
            : el.setAttribute('style', v)
    }

    _renderEvent(evName) {
        return function(el, v) {
            var evs = el.__plutoEvs || (el.__plutoEvs = {})
            if (evs[evName] !== v) {
                el.removeEventListener(evName, evs[evName])
                el.addEventListener(evName, evs[evName] = v)
            }
        }
    }

    _renderElse(el) {
        var { content, exprs } = this.compile(el.content || el);
        el.replaceWith(new RepeatedNode())
        el.innerHTML = ''
        return Object.assign(function(el, v, obj) {
            var isInited = el instanceof RepeatedNode
            if (!isInited) {
                Object.setPrototypeOf(el, RepeatedNode.prototype)
                el.content = content
                el.exprs = exprs
            }

            el.obj = obj
            el.repeat = obj.__plutoElse ? [] : [obj.item]
        }, { __stopCompilation: true })
    }

    _renderIf(el) {
        var { content, exprs } = this.compile(el.content || el);
        el.replaceWith(new RepeatedNode())
        el.innerHTML = ''
        return Object.assign(function(el, v, obj) {
            var isInited = el instanceof RepeatedNode
            if (!isInited) {
                Object.setPrototypeOf(el, RepeatedNode.prototype)
                el.content = content
                el.exprs = exprs
            }

            obj.__plutoElse = v
            el.obj = obj
            el.repeat = v ? [obj.item] : []
        }, { __stopCompilation: true })
    }

    _renderRepeat(el, attr) {
        var { content, exprs } = this.compile(el.content || el);
        el.replaceWith(new RepeatedNode())
        el.innerHTML = ''
        return Object.assign(function(el, v, obj) {
            var isInited = el instanceof RepeatedNode
            if (!isInited) {
                Object.setPrototypeOf(el, RepeatedNode.prototype)
                el.content = content
                el.exprs = exprs
            }

            obj.__plutoElse = v.length
            el.obj = obj
            el.repeat = v
        }, { __stopCompilation: true })
    }
}

class Renderer extends DocumentFragment {
    constructor(content, exprs, items) {
        super()
        this.exprs = exprs
        this.appendChild(document.importNode(content, true))

        // copy the list of generated elements from the template in order
        // to support removals
        this.elements = [].map.call(this.childNodes, child => child)
        this.paths = this.exprs.map((expr) => select(this, expr.path))
    }

    remove() {
        while (this.elements.length > 0) {
            this.elements.pop().remove()
        }
    }

    render(obj) {
        var else_ = obj.__plutoElse
        obj.__plutoElse = false

        var values = this.exprs.eval(obj)
        for (var i = 0 ; i < this.exprs.length ; i += 1) {
            var expr = this.exprs[i]
            var el = this.paths[i]
            var v = values[i]
            expr.render(el, v, obj)
        }

        var ev = new Event('pluto-rendered', { bubles: false })
        for (var el of this.paths) {
            el.dispatchEvent(ev)
        }

        obj.__plutoElse = else_
        return this
    }
}

// -- HELPER FUNCTIONS

function stopCompilation(el) {
    while (el.attributes.length) {
        el.removeAttribute(el.attributes[0].name)
    }
    while (el.childNodes.length > 0) {
        el.removeChild(el.childNodes[0])
    }
}

// Searches for an element from root based on the property-path to the child
// example: root = <body>, path = childNodes.3.childNode.7. Resolved by walking
// the path down to the child.
function select(root, path) {
    var el = root
    for (var i = 0; el !== undefined && i < path.length; i += 1) {
        el = el[path[i]]
    }
    return el
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
    code = exprs.map(function(expr, i) {
        if (expr.expr === undefined) {
            return '' // can happen in nested templates
        }

        if (expr.expr) {
            refs = refs.concat(getIdentifiers(expr.expr))
        }

        return `arguments[0][${i}] = T\`${expr.expr}\``
    }).join(';\n')

    // define the local variables and bind root-level functions to the provided
    // rendered object.
    var keys = refs.reduce((keys, k) => (keys[k] = true, keys), {})
    var locals = Object.keys(keys).map(function (k) {
        return `
            var ${k} = this["${k}"];
            typeof ${k} === 'function' && (${k} = bindFn(this, ${k}))
        `
    }).join(';\n')

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

    function bindFn(obj, fn) {
        var bound = fn.__plutoBound || (fn.__plutoBound = {})
        if (bound.to !== obj) {
            bound.to = obj
            bound.fn = fn.bind(obj)
        }

        return bound.fn
    }

    function T(s, v) {
        return arguments.length > 2 || typeof v === 'string'
            ? String.raw.apply(null, arguments)
            : v
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
