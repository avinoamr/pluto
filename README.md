# pluto
Native HTML Template Rendering

## Attributes vs Properties

Passing in arguments to custom elements, via HTML-syntax, can only be done
using the attribute notation. For example `class="name"` or `model={{obj}}`.
In both cases though, the attribute value would be transformed to a string,
`"name"` and `"{{obj}}"` respectively, so figuring out how to pass non-string
arguments to custom elements is a common problem.

Polymer solved it by notation differentiation: if the attribute name ends with a
dollar sign `$`, it should be set as an attribute. Otherwise, it will be a
property. Therefore `user-name$="hello"` and `user-name="hello"` are logically
different. One would set the attribute, while the other will set a property thus
using the attribute notation only as a way to pass in arguments, removing the
actual attribute from the element upon rendering. In some special cases (like
`class="name"`) they will break this rule and will set the attribute even when
it doesn't end with a dollar sign. Finally, they allow your custom elements to
define properties that would also reflect as attributes, which means that they
will still remain on the element even when they're used as properties. Up until
building Pluto, I didn't understand why there was a need for two different
attribute notations.

React solves it a little differently - everything is a property. That's why
assigning classes to an element is done via `className='name'` instead of just
`class='name'`. That's because setting a property `class` on an element would do
nothing, but setting `className` via javascript will build it correctly. In
other words you're using HTML (well JSX really) attributes to declare how
javascript should manipulate the element, not what attributes it should have. Up
until building pluto, I didn't understand why I couldn't just but in the actual
attribute names, like `class`.

After reading all of the docs carefully for both libraries I realize that they
do explain the rational behind these design decisions, yet they weren't very
clear or apparent for me when I initially worked with these libraries. While I
think both designs are OK, I do like JSX better, but believe that there might be
a better way.

So - this was my thought to experiment with - everything is logically an
attribute. You communicate with an element via setting attributes, not
properties which are more internal implementation details. Attributes are
basically the external API to an element. It does mean that we'll need a way to
work around these limitations:

    - attributes must be strings
    - some arguments (even strings) shouldn't be visible on the DOM (passwords?)

The latter can be simply done by the custom-element by removing the attribute
after it's set.

For the former, the following approaches exist:

    - Serialization (with JSON or otherwise). Can be tricky & risky. Objects can
    be huge, involve a high performance cost per render, and would break
    referencing. This is a no-go.
    - Piggy-back on the `attributeChangedCallback()` custom-elements API by
    calling it directly with the object, allowing the custom-element to do
    whatever they want with it.
    - Fire `attribute-changed` event on the custom element, allowing them to
    handle it however they'd like.
    - Call property setters on the custom-element (if they exist for the
    attribute name)
    - Populate some internal `.props` object and firing a `props-changed`
    event, to solve the problem that these non-string attributes aren't
    accessible after the callback was called.

One last after-thought: these other libraries benefit from the fact that the
also control the design of the custom-element or component. As a pure template-
rendering library, pluto doesn't. So perhaps it's best to just provide the
notations that will allow the user to define when they want to set a property,
and when an attribute - a la Polymer `$=`

## Expressions

Some use-cases involve passing in a complex or computed attribute to the
rendered elements. Such as `active={{ mode === 'one'}}`. The naive approach is
to use `eval()` to evaluate these expressions, but this has two problems:

    - `eval` is __very__ slow. Especially when there are several such
    expressions and frequent re-renders.
    - transforming the properties of the input object into local variables is
    tricky and usually requires another `eval()` that sets the local variables,
    which further adds to the slowness. See alternative below.

Polymer solves it by not allowing expressions. Instead, they just support
function calls that doesn't require any evaluation beyond just calling the
function.

React supports it because JSX allows arbitrary javascript expressions to be
evaluated native before the rendering, thus passing in the computed value in the
first place.

One alternative is kinda tricky, and moves most/all of the `eval()` to template
compilation time instead of render time:

    - Extract the list of identifiers referenced from the expression using
    regexp.
    Example: `['mode']`
    - Wrap the expression with a function that receives an object argument and
    fetches these idenitifers into local variables:
    Example: `function(obj) { var mode = obj.mode; return mode === 'select' }`.
    - Use this function in-place of the expression on the token, and invoke it
    with the render input upon render.

## Binding event listeners

Binding events is tricky, because we can't just set them as properties. For
example: `el.onclick = function() {}` will work but custom events like wouldn't
like `el.onaddtab = function() {}`.

Polymer solves it by a convention of starting these attribute names with `on-`,
so their template engine will identify the event name and will add normal
event listeners.

React solves it by not using events at all. You just pass the properties as any
other property to the inner element, which, instead of firing events, will just
invoke the function manually. So there's no event propagation.

Another issue with event listeners is that as they're function they can be
unbound, and thus yield weird/unexpected results and errors.

React simply forces you to bind your events before rendering. So you must have
something like `this.fn = this.fn.bind(this)` for any function you pass as an
event handler. There's a risk of binding the function on every render, because
it will result in a re-render of the element as it has changed.

Polymer uses a simpler approach. You specific a literal function name, instead
of a token that links to an actual function. They then just look-up this
function on the rendered element, with the element as it's bound context `this`.

Out of all of these - I think I prefer a mix of both options:
    - Using real events, with propagations is more inline with how the DOM
    works natively.
    - Using string literals as references to functions makes little sense in the
    context of a generic templating engine as we don't necessarily have a
    root custom-element that's guaranteed to contain these functions.

So in the final design, you mark event listeners with the `on-` prefix, but you
can pass in actual functions. We'll then bind these functions as event
listeners. 
