# Issues

Raised by the Reviewer (QA/product). Product language only: what was asked, what happened, what was expected. No causes, no fixes.

## I-1: Asked to sit down: Soul sat on the ground but its label and reply lagged or were missing

- **Asked:** "sit down"
- **Happened:** The Soul sat on the ground about 4 seconds after the request and stayed seated for the rest of the minute. The chat showed only the player's message and no reply from the agent. The Soul's label above its head still said 'Standing around' for roughly 30 seconds, then changed to 'Sit on the ground'. The other Soul's label also changed to 'Sit on the ground' near the end.
- **Expected:** The Soul sits down, and the label and chat agree with what the Soul is doing. A short confirmation appears in the chat.
- **Where / when:** Commons Pavilion, within the first minute after the request, in chat
- **How often:** Once, in this request (this session: 1; earlier sessions: none)
- **Score / class:** P / O3 · noticed by the player: yes · input depth: realistic
- **Evidence:** `samples at 4.4 s, 27.1 s and 48.7 s: seated, sit-ground`, `legible bubbles at 26.6 s: Quin 'Standing around'; at 37.6 s: 'Sit on the ground'`, `chat transcript: no reply shown to the player`, `screenshots shots/quin/172309.jpg, 173046.jpg, 186161.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/quin/172309.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/quin/173046.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/quin/186161.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/quin/195724.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/quin/217386.jpg`
- **Repro:** scripted scenario in issues.json (`repro-basics-walk-act-1-quin-002`)

## I-2: Pip sat on the bare ground instead of a seat

- **Asked:** "sit down"
- **Happened:** Pip sat on the ground of the pavilion's sheltered deck. The chat reply said Pip was seated 'on the ground rather than on a seat'. The sit receipt stayed 'started' and the speech bubble read 'Sit on the ground'.
- **Expected:** Pip sits down on a seat or bench at the pavilion, or otherwise sits in a way that makes sense for the spot.
- **Where / when:** Commons Pavilion, sheltered deck, from about 3.5 s after the request until the end of the observation window (about 80 s).
- **How often:** Once in this session. (this session: 1; earlier sessions: none)
- **Score / class:** P / O2 · noticed by the player: yes · input depth: realistic
- **Evidence:** `chat reply: 'seated, on the ground rather than on a seat'`, `samples at 13.3 s, 36.4 s and 59.5 s: posture seated, activity sit-ground, on: null`, `bubble 'Sit on the ground' at 46.3 s to 80.7 s`, `screenshots shots/pip/198992.jpg, 201918.jpg and 211712.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/198992.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/201918.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/211712.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/221335.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/234833.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/245256.jpg`, `/home/gene/souls-playtest/results/saturn-real2-20261107/_saturn-preflight-r1/shots/pip/257913.jpg`
- **Repro:** scripted scenario in issues.json (`repro-basics-walk-act-1-pip-002`)
