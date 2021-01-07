const assert = require("assert");
const valve = require("../src/valve.js");

describe("Test Helpers", function() {
	describe("#getIndexes()", function() {
	  it("Should return array containing indexes of zero: [0, 2, 5]", function() {
	  	let arr = valve.getIndexes([0, 1, 0, 2, 3, 0], 0);
	    assert.equal(arr[0], 0);
	    assert.equal(arr[1], 2);
	    assert.equal(arr[2], 5);
	  });
	});

	describe("#hasAncestor", function() {
		let tree = {foo: ["bar", "baz"], baz: [], bar: ["quax"], "quax": []};
		it("'foo' should have ancestor 'quax'", function() {
			assert.ok(valve.hasAncestor(tree, "quax", "foo"));
		});
		it("'foo' should have direct ancestor 'baz'", function() {
			assert.ok(valve.hasAncestor(tree, "baz", "foo", true));
		});
		it("'foo' should have ancestor self", function() {
			assert.ok(valve.hasAncestor(tree, "foo", "foo"));
		});
		it("'foo' should not have direct ancestor 'quax'", function() {
			assert.ok(!valve.hasAncestor(tree, "quax", "foo", true));
		});
		it("'quax' should not have ancestor 'baz'", function() {
			assert.ok(!valve.hasAncestor(tree, "baz", "quax"));
		});
		it("'foo' should not have direct ancestor self", function() {
			assert.ok(!valve.hasAncestor(tree, "foo", "foo", true));
		});
	});

	describe("#parsedToString", function() {
		it("Round trip parsed->parsedToString should be equal", function() {
			let text = "tree(Label, external.Label, split=\", \")";
			let parsed = valve.parse(text);
			assert.equal(valve.parsedToString(parsed), text);
		});
	});

	describe("#idxToA1", function() {
		it("Should return D10", function() {
			assert.equal(valve.idxToA1(10, 4), "D10");
		});
		it("Should return AN10", function() {
			assert.equal(valve.idxToA1(10, 40), "AN10");
		});
		it("Should return OJ10", function() {
			assert.equal(valve.idxToA1(10, 400), "OJ10");
		});
	});
});
