# Link Library
*A Link to the Web*

[![Build Status](https://travis-ci.org/fletcher91/link-lib.svg?branch=master)](https://travis-ci.org/fletcher91/link-lib)

This package aims to make building rich web applications quick and easy by providing a wrapper around 
[rdflib.js](https://github.com/linkeddata/rdflib.js)'s store, adding high-level API's for view rendering, data querying
& manipulation, and API communication. See the [link-redux](https://github.com/fletcher91/link-redux) package on how to
use this in a React project.

To transform your Rails application into a linked-data serving beast, see our 
[Active Model Serializers plugin](https://github.com/argu-co/rdf-serializers).

This was built at [Argu](https://argu.co), if you like what we do, these technologies
or open data, send us [a mail](mailto:info@argu.co).

## Example
See the [TODO app](https://fletcher91.github.io/link-redux-todo/#/) for a live example and 
[link-redux-todo](https://github.com/fletcher91/link-redux-todo) for the implementation. Mind that it isn't connected to
a back-end, so it's only a demo for the view rendering mechanism.

## Installation

`npm install link-lib rdflib`

`yarn add link-lib rdflib`

The package externalizes the Promise API, so make sure to include your own when targeting platforms without native
support.

# Usage

Though generality is kept in mind building this library, it places some requirements on the targeted API;

* The API should be a Linked Data serving RESTful API (So it should return some LD format like turtle, nquads, JSON-LD).
* Each IRI SHOULD be a URL. All resources should be fetchable on their own IRI, subresources (#subdoc) or blank nodes 
    should always be included in the resource which mentions them.

### Included namespace prefixes

See the [utilities](https://github.com/fletcher91/link-lib/blob/master/src/utilities.ts) for the namespaces included by
default.

### Changes to rdflib.js
This library instantiates rdflib.js for some core tasks (low-level querying, processing), but also makes some changes to
its inner workings. See the [RDFStore](https://github.com/fletcher91/link-lib/blob/master/src/RDFStore.ts) for the main
wrapper and [DataProcessor](https://github.com/fletcher91/link-lib/blob/master/src/processor/DataProcessor.ts) for
changes to the rdflib Fetcher.

Following are some of the most important changes;

* All named nodes MUST be instantiated via the memoization mechanism 
([see the utilities](https://github.com/fletcher91/link-lib/blob/master/src/utilities.ts)). This is done to enable the 
use of nested number arrays over string (iri) maps for performance gains.
* To be able to keep track of changes, principles of immutability should be maintained, it is assumed that changes are
either server provided or done via well-documented API's. Return values from the store might be frozen, and making
changes directly will result in unexpected behaviour.
* Some additional work is done to make the return values from rdflib more consistent (e.g. returning empty arrays over
null or undefined).

# Contributing

The usual stuff. Open an issue to discuss a change, open PR's from topic-branches targeted to master for bugfixes and
refactors.
