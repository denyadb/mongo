/**

 * Confirms that index builds on a secondary wait for the commitIndexBuild oplog entry before
 * committing.
 * Requires two phase index builds to be enabled via the twoPhaseIndexBuild server parameter.
 * @tags: [requires_replication]
 */
(function() {
"use strict";

load('jstests/noPassthrough/libs/index_build.js');

const rst = new ReplSetTest({
    nodes: [
        {},
        {
            // Disallow elections on secondary.
            rsConfig: {
                priority: 0,
                votes: 0,
            },
        },
    ]
});
const nodes = rst.startSet();
rst.initiate();

const primary = rst.getPrimary();
const testDB = primary.getDB('test');
const coll = testDB.getCollection('test');

const secondary = rst.getSecondary();
const secondaryDB = secondary.getDB(testDB.getName());
const secondaryColl = secondaryDB.getCollection(coll.getName());

const enableTwoPhaseIndexBuild =
    assert.commandWorked(primary.adminCommand({getParameter: 1, enableTwoPhaseIndexBuild: 1}))
        .enableTwoPhaseIndexBuild;
if (!enableTwoPhaseIndexBuild) {
    jsTestLog('Two phase index builds not enabled, skipping test.');
    rst.stopSet();
    return;
}

assert.commandWorked(coll.insert({a: 1}));

// Start index build on primary, but prevent it from finishing.
IndexBuildTest.pauseIndexBuilds(primary);
IndexBuildTest.pauseIndexBuilds(secondary);
const createIdx = IndexBuildTest.startIndexBuild(primary, coll.getFullName(), {a: 1});

// When the index build starts on the secondary, find its op id.
try {
    IndexBuildTest.waitForIndexBuildToStart(secondaryDB);

    IndexBuildTest.resumeIndexBuilds(secondary);
    IndexBuildTest.waitForIndexBuildToStop(secondaryDB);
    IndexBuildTest.assertIndexes(secondaryColl, 2, ["_id_", "a_1"]);
} finally {
    // Wait for the index build to stop.
    IndexBuildTest.resumeIndexBuilds(primary);
}

IndexBuildTest.waitForIndexBuildToStop(testDB);

// Expect successful createIndex command invocation in parallel shell. A new index should be
// present on the primary.
createIdx();
IndexBuildTest.assertIndexes(coll, 2, ['_id_', 'a_1']);

// Check that index was created on the secondary.
IndexBuildTest.assertIndexes(secondaryColl, 2, ['_id_', 'a_1']);

rst.stopSet();
})();