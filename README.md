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
