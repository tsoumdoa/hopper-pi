// Classify roots before pagination so diagnostic runs never change chat visibility.
// Legacy fixtures require both an exact numeric request suffix and their original text.
export const browserRootsView = `
CREATE VIEW IF NOT EXISTS browser_roots AS
SELECT rowid AS sequence, *, COALESCE(
 json_extract(payload,'$.diagnosticFixture')='shared-host-native-smoke'
 OR (json_extract(payload,'$.requestId') GLOB 'native-launch-probe-root-[0-9]*'
     AND substr(json_extract(payload,'$.requestId'),26) NOT GLOB '*[^0-9]*'
     AND json_extract(payload,'$.text')='Explicit native launch acceptance fixture. No model driver is started for this test.')
 OR (json_extract(payload,'$.requestId') GLOB 'transfer-fixture-root-[0-9]*'
     AND substr(json_extract(payload,'$.requestId'),23) NOT GLOB '*[^0-9]*'
     AND json_extract(payload,'$.text')='Explicit deterministic native launch, New and geometry transfer fixture. No model API is called.'), 0
) AS fixture
FROM tasks WHERE parent_task_id IS NULL;
`;

export const browserRecoveryTasksQuery = `
SELECT t.id AS task_id, t.conversation_id, r.id AS browser_root_id FROM tasks t
JOIN browser_roots r ON r.id=COALESCE(t.root_task_id,t.parent_task_id,t.id)
WHERE NOT r.fixture AND t.state='uncertain'
 AND NOT EXISTS(SELECT 1 FROM recovery_dispositions d WHERE d.task_id=t.id)
`;

export const browserConversationsQuery = `
WITH recovery AS (${browserRecoveryTasksQuery}),
eligible AS (SELECT rowid AS sequence, * FROM conversations),
visibility AS (
 SELECT r.conversation_id, MAX(r.fixture) AS has_fixture, MAX(NOT r.fixture) AS has_user
 FROM browser_roots r JOIN eligible c ON c.id=r.conversation_id GROUP BY r.conversation_id
)
SELECT c.sequence, c.id, c.created_at, c.title, c.archived_at, c.document_label,
 COALESCE((SELECT MAX(r.updated_at) FROM browser_roots r WHERE r.conversation_id=c.id AND NOT r.fixture),c.created_at) AS last_activity_at,
 (SELECT r.state FROM browser_roots r WHERE r.conversation_id=c.id AND NOT r.fixture AND r.state IN ('queued','running','suspending','awaiting_user') ORDER BY CASE WHEN r.state='queued' THEN 1 ELSE 0 END,r.sequence LIMIT 1) AS live_state,
 (SELECT COALESCE(json_extract(r.payload,'$.messageTarget'),json_extract(r.payload,'$.bindings[0]')) FROM browser_roots r WHERE r.conversation_id=c.id AND NOT r.fixture ORDER BY r.sequence LIMIT 1) AS document_target,
 (SELECT COALESCE(json_extract(r.payload,'$.messageTarget'),json_extract(r.payload,'$.bindings[0]')) FROM browser_roots r WHERE r.conversation_id=c.id AND NOT r.fixture ORDER BY r.sequence DESC LIMIT 1) AS last_message_target,
 EXISTS(SELECT 1 FROM recovery WHERE conversation_id=c.id) AS recovery_required,
 (SELECT json_group_array(DISTINCT COALESCE(json_extract(r.payload,'$.messageTarget.lifecycleInstanceId'),
   json_extract(r.payload,'$.bindings[0].lifecycleInstanceId')))
  FROM browser_roots r WHERE r.conversation_id=c.id AND NOT r.fixture) AS instance_ids,
 (SELECT json_group_array(DISTINCT COALESCE(json_extract(o.owner,'$.binding.lifecycleInstanceId'),
   json_extract(o.owner,'$.lifecycleInstanceId')))
  FROM (SELECT task_id,owner FROM turns UNION ALL SELECT task_id,owner FROM operations) o
  JOIN recovery r ON r.task_id=o.task_id WHERE r.conversation_id=c.id AND o.owner IS NOT NULL) AS recovery_instance_ids,
 COALESCE(v.has_fixture,0) AS has_fixture,
 (SELECT json_extract(r.payload,'$.text') FROM browser_roots r
   WHERE r.conversation_id=c.id AND NOT r.fixture ORDER BY r.sequence LIMIT 1) AS first_user_text
FROM eligible c LEFT JOIN visibility v ON v.conversation_id=c.id
WHERE v.has_fixture IS NULL OR v.has_user
ORDER BY last_activity_at DESC,c.sequence DESC;
`;
