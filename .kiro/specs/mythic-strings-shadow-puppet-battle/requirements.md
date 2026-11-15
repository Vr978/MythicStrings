# Requirements Document

## Introduction

Mythic Strings is a 2D turn-based fighting game styled after Tholu Bommalata, the leather shadow puppetry tradition of Andhra Pradesh. Characters are translucent, colored, jointed leather puppets rendered as physics-driven 2D ragdolls in front of a back-lit screen.

The game has no fixed roster or script. A player types a matchup such as "Arjun vs Duryodhan", and a multi-agent AI pipeline generates the scene, the characters, and their traits. During battle, each player has a short timed window to type a new move in free text (for example "make clones from strands of hair" or "fire a volley of a hundred arrows") or to pick a previous or recommended move. The AI turns the text into a modular Move Block built from registered physics primitives, a guardrail model screens the text for derogatory content, the physics engine validates the move, and a scoring model assigns damage from several criteria including creativity, character traits, and public voting.

Every accepted move is stored in a Move Library indexed by semantic similarity, so later requests for similar moves reuse and re-parameterize existing blocks instead of generating new ones.

## Glossary

- **Game_Client**: The player-facing 2D application that renders the stage, accepts input, and plays move animations.
- **Player**: A human participant who controls one Puppet_Character in a Battle.
- **Spectator**: A human viewer of a Battle who may cast votes on moves but does not control a Puppet_Character.
- **Scenario_Prompt**: Free-text input from a Player that describes a matchup or fighting sequence (for example "Arjun vs Duryodhan").
- **Scenario_Orchestrator**: The multi-agent AI pipeline that turns a Scenario_Prompt into a Scenario by coordinating the Scene_Agent, Character_Agent, and Trait_Agent.
- **Scene_Agent**: The AI agent that generates the stage setting, backdrop, and narrative context of a Scenario.
- **Character_Agent**: The AI agent that generates each Puppet_Character's identity, appearance, and joint structure.
- **Trait_Agent**: The AI agent that generates each Puppet_Character's Traits and starting stats.
- **Scenario**: The generated battle definition containing the Stage, two or more Puppet_Characters, their Traits, and narrative context.
- **Stage**: The back-lit shadow-screen environment where a Battle takes place.
- **Puppet_Character**: A combatant represented as a jointed 2D ragdoll in the Tholu Bommalata visual style.
- **Trait**: A named attribute of a Puppet_Character (for example "master archer", "mace strength", "divine weapon affinity") with a numeric magnitude that affects Damage_Score.
- **Health_Points**: The integer amount of remaining health of a Puppet_Character; a Puppet_Character with 0 Health_Points is defeated.
- **Physics_Engine**: The open-source 2D rigid-body physics engine that simulates ragdolls, projectiles, collisions, and forces.
- **Puppet_Renderer**: The Game_Client component that draws Puppet_Characters and effects in the Tholu Bommalata visual style.
- **Battle**: A single match between Puppet_Characters in a Scenario, made of a sequence of Turns.
- **Turn_Manager**: The component that controls Turn order, Turn phases, and Battle end conditions.
- **Turn**: One Player's opportunity to perform one Move.
- **Move_Input_Window**: The time-limited period during a Turn in which the acting Player types a Move_Prompt or selects a stored Move.
- **Move_Prompt**: Free-text input from a Player that describes a move.
- **Move**: An action performed by a Puppet_Character during a Turn, defined by a Move_Block.
- **Move_Primitive**: A registered, pre-built, parameterized physics behavior (for example spawn_clones, projectile_volley, apply_impulse, summon_object, transform_limb) that the game can execute.
- **Move_Block**: A structured, versioned description of a Move composed of an ordered set of Move_Primitives with parameters, conforming to the Move_Block_Schema.
- **Move_Block_Schema**: The formal data schema that defines valid Move_Blocks.
- **Move_Generator**: The AI component that converts a Move_Prompt into a Move_Block.
- **Move_Parser**: The component that parses a serialized Move_Block document into a Move_Block object.
- **Move_Printer**: The component that formats a Move_Block object into a serialized Move_Block document.
- **Move_Library**: The persistent store of accepted Move_Blocks, each indexed with a semantic embedding of the originating Move_Prompt.
- **Similarity_Score**: A value from 0.0 to 1.0 that measures semantic similarity between a Move_Prompt and a Move_Library entry.
- **Reuse_Threshold**: The configurable minimum Similarity_Score at which the Move_Library returns an existing Move_Block instead of generating a new one (default 0.85).
- **Recommendation_Engine**: The component that proposes stored Moves to the acting Player for the current Turn.
- **Move_Validator**: The component that simulates a Move_Block in the Physics_Engine and decides whether the Move is physically executable on the current Stage.
- **Guardrail**: The fast content-moderation AI model that classifies Player text and AI-generated text as acceptable or derogatory.
- **Derogatory_Content**: Text that contains hate speech, slurs, harassment, sexual content, demeaning depictions of religious or cultural figures, or graphic gore beyond stylized puppet combat.
- **Fallback_Move**: A pre-approved Move_Block from a fixed default set that is used when a Player's Move cannot be accepted in time.
- **Damage_Scorer**: The AI component that computes the Damage_Score of a validated Move.
- **Damage_Score**: The integer amount of Health_Points removed from the target Puppet_Character by a Move.
- **Creativity_Score**: A value from 0.0 to 1.0 that rates the novelty and inventiveness of a Move relative to Moves already used in the Battle and stored in the Move_Library.
- **Voting_Service**: The component that collects and tallies Spectator votes on Moves.
- **Voting_Window**: The configurable period after a Move animation during which Spectators may vote on that Move (default 10 seconds).
- **Vote_Share**: The fraction, from 0.0 to 1.0, of votes cast in a Voting_Window that rated the Move positively.

## Requirements

### Requirement 1: Tholu Bommalata Visual Style

**User Story:** As a Player, I want the characters and stage to look like Tholu Bommalata leather puppets on a lit screen, so that the game reflects the traditional art form.

#### Acceptance Criteria

1. THE Puppet_Renderer SHALL render each Puppet_Character as a set of 2 to 20 flat, colored segments. Each segment SHALL have an opacity between 0.3 and 0.9 inclusive, where 0.0 is fully transparent and 1.0 is fully opaque.
2. THE Puppet_Renderer SHALL draw a pivot marker at every joint between two connected Puppet_Character segments. Each marker SHALL be visible at the joint's on-screen position in every rendered frame in which the joint is inside the visible Stage area.
3. THE Puppet_Renderer SHALL render the Stage as a back-lit screen whose light shows through each Puppet_Character segment. Where 2 or more segments overlap on screen, the overlapping area SHALL be darker than any of the individual segments alone.
4. WHEN the Character_Agent output specifies perforation and ornament patterns for a Puppet_Character segment, THE Puppet_Renderer SHALL render each perforation as a fully transparent opening through which the Stage backlight is visible at full brightness. Each ornament pattern SHALL appear at the position on the segment that the Character_Agent output specifies.
5. IF the Character_Agent output for a Puppet_Character segment has no perforation or ornament pattern data, or the data cannot be rendered, THEN THE Puppet_Renderer SHALL render that segment as a solid translucent segment without perforations, without interrupting the Battle and without changing the segment's shape or joints.
6. WHEN a Move creates a projectile, clone, or summoned object, THE Puppet_Renderer SHALL render that effect as flat, colored segments with opacity between 0.3 and 0.9 inclusive, lit by the same Stage backlight as the Puppet_Characters.
7. WHILE a Battle is running with up to 4 Puppet_Characters and their active Move effects on the Stage, THE Game_Client SHALL display the Stage on the minimum supported hardware at an average of at least 30 frames per second over every consecutive 5-second interval, with no single frame taking longer than 100 milliseconds to display.

### Requirement 2: Ragdoll Physics Characters

**User Story:** As a Player, I want characters to move and react like jointed ragdolls, so that every hit and fall looks dynamic instead of pre-animated.

#### Acceptance Criteria

1. WHEN a Scenario is loaded into a Battle, THE Physics_Engine SHALL create each Puppet_Character as a set of 6 to 20 rigid bodies connected by joints, with each joint's lower and upper angle limits taken from the Character_Agent output for that Puppet_Character.
2. WHEN a Move applies a force or collision to a Puppet_Character, THE Physics_Engine SHALL apply the resulting impulse only to the Puppet_Character segments that the force targets or that the colliding object touches, in the same simulation step in which the force or contact occurs.
3. WHILE a Puppet_Character has more than 0 Health_Points and no Move animation is playing, THE Physics_Engine SHALL use joint motors to drive the Puppet_Character into a standing pose, defined as the torso segment within 15 degrees of vertical with at least one foot segment touching the Stage floor, and SHALL reach that pose within 2 seconds after the last Move animation ends.
4. THE Physics_Engine SHALL keep every joint angle of every Puppet_Character within that joint's lower and upper angle limits, with a tolerance of no more than 2 degrees, at the end of every simulation step.
5. WHEN a Puppet_Character reaches 0 Health_Points, THE Physics_Engine SHALL release all joint motors of that Puppet_Character within the same simulation step, so that the Puppet_Character collapses under gravity while its joint angle limits stay in force.
6. IF the Character_Agent output for a Puppet_Character is missing joint angle limits, gives a lower limit greater than the upper limit, or defines fewer than 6 or more than 20 rigid bodies, THEN THE Physics_Engine SHALL build that Puppet_Character from a default humanoid joint structure with predefined angle limits and keep the rest of the Character_Agent output for that Puppet_Character, such as identity and appearance.
7. WHILE a Puppet_Character has 0 Health_Points, THE Physics_Engine SHALL keep the joint motors of that Puppet_Character released until the Battle ends.
8. IF a force applied to a Puppet_Character would push a joint angle past its limit, THEN THE Physics_Engine SHALL stop the joint at the limit and keep all joints of that Puppet_Character connected, with no segment detaching.

### Requirement 3: Scenario Prompt Input

**User Story:** As a Player, I want to type any matchup in my own words, so that I can create my own battle instead of choosing from a fixed list.

#### Acceptance Criteria

1. THE Game_Client SHALL provide a text field that accepts a Scenario_Prompt of 1 to 500 characters, with length counted after removing leading and trailing whitespace.
2. WHEN a Player submits a Scenario_Prompt of 1 to 500 characters, THE Guardrail SHALL classify the Scenario_Prompt as acceptable or Derogatory_Content within 2 seconds of submission and before the Scenario_Orchestrator receives the Scenario_Prompt.
3. IF a submitted Scenario_Prompt has 0 characters or contains only whitespace, or is longer than 500 characters, THEN THE Game_Client SHALL display a validation message that states the 1 to 500 character limit, SHALL NOT send the Scenario_Prompt to the Guardrail, and SHALL keep the Scenario_Prompt text unchanged and editable.
4. IF the Guardrail classifies a Scenario_Prompt as Derogatory_Content, THEN THE Game_Client SHALL display a rejection message naming the Derogatory_Content category that was detected, SHALL NOT send the Scenario_Prompt to the Scenario_Orchestrator, and SHALL keep the Scenario_Prompt text editable so that the Player can submit a new Scenario_Prompt.
5. WHEN the Guardrail classifies a Scenario_Prompt as acceptable, THE Game_Client SHALL send the unchanged Scenario_Prompt text to the Scenario_Orchestrator and SHALL display a progress indicator showing that Scenario generation has started.
6. IF the Guardrail does not return a classification within 2 seconds of submission or returns an error, THEN THE Game_Client SHALL display an error message stating that the Scenario_Prompt could not be checked, SHALL NOT send the Scenario_Prompt to the Scenario_Orchestrator, and SHALL keep the Scenario_Prompt text unchanged and editable for resubmission.
7. WHILE the Guardrail is classifying a submitted Scenario_Prompt, THE Game_Client SHALL disable the submit action so that only one Scenario_Prompt is classified at a time per Player.

### Requirement 4: Multi-Agent Scenario Generation

**User Story:** As a Player, I want a team of AI agents to build the whole scene, characters, and traits from my prompt, so that I get a complete, playable battle without manual setup.

#### Acceptance Criteria

1. WHEN the Scenario_Orchestrator receives an accepted Scenario_Prompt, THE Scenario_Orchestrator SHALL invoke the Scene_Agent to produce the Stage and narrative context, the Character_Agent to produce each Puppet_Character's identity, appearance, and joint structure, and the Trait_Agent to produce each Puppet_Character's Traits and starting stats, and SHALL combine these outputs into one Scenario.
2. THE Scenario_Orchestrator SHALL produce a Scenario that contains exactly one Stage, between 2 and 4 Puppet_Characters inclusive, between 3 and 6 Traits per Puppet_Character, a numeric magnitude for each Trait, and a starting Health_Points integer greater than 0 for each Puppet_Character.
3. WHEN the Scenario_Prompt names between 1 and 4 specific characters, THE Character_Agent SHALL generate exactly one Puppet_Character for each named character, using the name given in the Scenario_Prompt.
4. WHEN the Scenario_Prompt names 0 or 1 characters, THE Character_Agent SHALL generate additional Puppet_Characters consistent with the Stage and narrative context produced by the Scene_Agent until the Scenario contains exactly 2 Puppet_Characters.
5. WHEN the Scenario_Orchestrator completes a Scenario, THE Guardrail SHALL classify every generated Puppet_Character name, every generated description, the narrative context, and every Trait name as acceptable or Derogatory_Content before the Game_Client displays any part of the Scenario.
6. WHEN the Scenario_Orchestrator receives an accepted Scenario_Prompt, THE Scenario_Orchestrator SHALL deliver a complete Scenario that satisfies criterion 2 and has passed Guardrail classification to the Game_Client within 30 seconds of receiving the Scenario_Prompt.
7. WHILE the Scenario_Orchestrator is generating a Scenario, THE Game_Client SHALL display a separate status for each of the Scene_Agent, the Character_Agent, and the Trait_Agent, each showing one of the values pending, in progress, complete, or failed, and SHALL update each status within 1 second of that agent's status changing.
8. IF any agent fails to return output, returns output that does not satisfy criterion 2, or the 30-second limit elapses before a complete Scenario is delivered, THEN THE Scenario_Orchestrator SHALL return an error to the Game_Client indicating which agent failed or that the time limit elapsed, and THE Game_Client SHALL display no partial Scenario, SHALL keep the Player's Scenario_Prompt text unchanged, and SHALL offer the Player the options to retry generation or edit the Scenario_Prompt.
9. WHEN the Player requests regeneration of the Stage, a single Puppet_Character, or a single Trait in a displayed Scenario, THE Scenario_Orchestrator SHALL regenerate only the selected element and SHALL leave every other Scenario element unchanged. The regenerated element SHALL pass Guardrail classification and be delivered to the Game_Client within 30 seconds of the request.
10. IF the Scenario_Prompt names more than 4 specific characters, THEN THE Scenario_Orchestrator SHALL generate no Scenario, SHALL return an error to the Game_Client indicating the 4-character maximum, and THE Game_Client SHALL keep the Scenario_Prompt text for the Player to edit.
11. IF the Guardrail classifies any generated Scenario element as Derogatory_Content, THEN THE Scenario_Orchestrator SHALL withhold that element from the Game_Client and regenerate only that element, up to 2 regeneration attempts within the 30-second limit. If the element is still classified as Derogatory_Content after the 2 attempts, the Scenario_Orchestrator SHALL handle the failure as defined in criterion 8.
12. IF regeneration of a single Scenario element fails, exceeds 30 seconds, or produces Derogatory_Content after 2 attempts, THEN THE Game_Client SHALL keep the previously displayed version of that element, SHALL display an error indicating the regeneration failed, and SHALL offer the Player the option to retry regenerating that element.

### Requirement 5: Character Traits

**User Story:** As a Player, I want each character to have traits that match their mythology, so that moves fitting a character's strengths are more effective.

#### Acceptance Criteria

1. WHEN the Scenario_Orchestrator requests Traits for a Puppet_Character, THE Trait_Agent SHALL assign that Puppet_Character between 3 and 6 Traits inclusive, where each Trait has a name of 1 to 40 characters, a description of 1 to 200 characters, and an integer magnitude from 1 to 10 inclusive.
2. THE Trait_Agent SHALL give each Trait of a Puppet_Character a name that no other Trait of the same Puppet_Character uses, with names compared case-insensitively.
3. WHEN the Trait_Agent assigns Traits to a Puppet_Character, THE Trait_Agent SHALL set that Puppet_Character's starting Health_Points to exactly 100.
4. WHEN a Scenario is displayed, THE Game_Client SHALL show, for each Puppet_Character in the Scenario, the Puppet_Character's name, the name, description, and magnitude of every assigned Trait, and the current Health_Points as an integer.
5. WHEN a Puppet_Character's Health_Points change during a Battle, THE Game_Client SHALL update the displayed Health_Points of that Puppet_Character within 1 second of the change.
6. THE Trait_Agent SHALL produce, for every generated Scenario, Traits such that the absolute difference between the sums of Trait magnitudes of any two Puppet_Characters in that Scenario is at most 10 (balance invariant).
7. IF the Trait_Agent output for a Scenario violates criterion 1, 2, or 6, or the Guardrail classifies any Trait name or description as Derogatory_Content, THEN THE Scenario_Orchestrator SHALL discard all Traits generated for that Scenario and request a new set from the Trait_Agent, up to 3 regeneration attempts in total.
8. IF the Trait_Agent has not produced a Trait set that passes criteria 1, 2, and 6 and the Guardrail check after 3 regeneration attempts, THEN THE Scenario_Orchestrator SHALL stop Scenario generation, leave the Battle unstarted, and the Game_Client SHALL show the Player an error message stating that character Traits could not be generated and offering to resubmit the Scenario_Prompt.

### Requirement 6: Turn-Based Combat

**User Story:** As a Player, I want the battle to proceed turn by turn, so that I have time to think up a move and watch it play out.

#### Acceptance Criteria

1. WHEN a Battle starts, THE Turn_Manager SHALL pick the first acting Puppet_Character at random, giving each Puppet_Character in the Scenario an equal chance, and SHALL fix the Turn order for the rest of the Battle as a cycle that starts from that Puppet_Character and follows the order in which the Scenario lists its Puppet_Characters.
2. WHEN a Turn ends and the next Puppet_Character in the fixed Turn order has 0 Health_Points, THE Turn_Manager SHALL skip that Puppet_Character and give the Turn to the next Puppet_Character in the order that has more than 0 Health_Points.
3. THE Turn_Manager SHALL run each Turn in this phase order, with exactly one active phase at a time and no phase starting before the previous phase completes: Move_Input_Window, moderation by the Guardrail, Move resolution, validation by the Move_Validator, animation, Voting_Window, damage application.
4. WHILE a Turn is in progress, THE Turn_Manager SHALL accept Move input only from the Player who controls the acting Puppet_Character, and only during that Turn's Move_Input_Window.
5. IF a Player submits Move input while a Turn is in progress but that Player does not control the acting Puppet_Character, or the Turn is outside its Move_Input_Window, THEN THE Turn_Manager SHALL discard the input, leave the current Turn's phase and Move unchanged, and show that Player a notification that the input was rejected because it is not that Player's Move_Input_Window.
6. WHEN damage application for a Turn completes and no Battle end condition is met, THE Turn_Manager SHALL start the next Turn for the next eligible Puppet_Character in the fixed Turn order.
7. WHEN damage application for a Turn completes and exactly one Puppet_Character has more than 0 Health_Points, THE Turn_Manager SHALL end the Battle, declare that Puppet_Character the winner, and start no further Turns.
8. IF damage application for a Turn completes and every Puppet_Character has 0 Health_Points, THEN THE Turn_Manager SHALL end the Battle, declare a draw, and start no further Turns.
9. WHERE a Turn limit between 1 and 200 Turns inclusive is configured, WHEN damage application for the Turn whose number equals the Turn limit completes and more than one Puppet_Character still has more than 0 Health_Points, THE Turn_Manager SHALL end the Battle and declare the winner to be the Puppet_Character with the highest Health_Points. If two or more Puppet_Characters share the highest Health_Points, THE Turn_Manager SHALL declare a draw.
10. THE Turn_Manager SHALL keep every Puppet_Character's Health_Points as an integer from 0 to that Puppet_Character's starting Health_Points, inclusive, after every phase of every Turn. When applied damage would take Health_Points below 0, THE Turn_Manager SHALL set them to 0.

### Requirement 7: Timed Move Input Window

**User Story:** As a Player, I want only a short time to type my move, so that the battle stays fast and tense.

#### Acceptance Criteria

1. WHEN a Turn starts, THE Game_Client SHALL open a Move_Input_Window for the acting Player with a configurable duration that is a whole number of seconds from 5 to 30 inclusive (default 10 seconds).
2. WHILE the Move_Input_Window is open, THE Game_Client SHALL display to the acting Player a countdown that shows the remaining whole seconds, rounded up, and that updates at least once per second until it reaches 0.
3. WHILE the Move_Input_Window is open, THE Game_Client SHALL accept a Move_Prompt of 1 to 200 characters and SHALL prevent entry of any character beyond the 200th.
4. WHEN the acting Player submits a Move_Prompt that contains at least 1 non-whitespace character, or selects a stored Move, before the countdown reaches 0, THE Game_Client SHALL close the Move_Input_Window and pass that Move_Prompt or stored Move to the Turn_Manager.
5. IF the countdown reaches 0 while the Move_Prompt field contains at least 1 non-whitespace character, THEN THE Game_Client SHALL close the Move_Input_Window and pass the text in the Move_Prompt field at that moment to the Turn_Manager as the submitted Move_Prompt.
6. IF the countdown reaches 0 while the Move_Prompt field is empty or contains only whitespace and no stored Move is selected, THEN THE Turn_Manager SHALL perform a Fallback_Move for the acting Puppet_Character.
7. IF the acting Player attempts to submit a Move_Prompt that is empty or contains only whitespace while the countdown is above 0, THEN THE Game_Client SHALL reject the submission, keep the Move_Input_Window open, keep the countdown running, and display an indication that the Move_Prompt is empty.
8. IF the countdown reaches 0 while the Move_Prompt field is empty or contains only whitespace and a stored Move is selected, THEN THE Game_Client SHALL close the Move_Input_Window and pass the selected stored Move to the Turn_Manager.
9. WHEN the Move_Input_Window closes, THE Game_Client SHALL disable the Move_Prompt field and stored Move selection, so that any input received after closing is not passed to the Turn_Manager for that Turn.

### Requirement 8: Selecting Previous and Recommended Moves

**User Story:** As a Player, I want to pick from my earlier moves or suggested moves, so that I can act quickly when I cannot think of something new.

#### Acceptance Criteria

1. WHEN a Move_Input_Window opens, THE Recommendation_Engine SHALL present between 0 and 5 recommended Moves from the Move_Library. The Moves SHALL be ordered from highest to lowest relevance, where relevance is scored against the acting Puppet_Character's Traits, the Health_Points of both Puppet_Characters, and the Moves already used in the current Battle. No Move_Block SHALL appear more than once in the list.
2. WHEN a Move_Input_Window opens, THE Game_Client SHALL present up to 10 distinct Moves used by the acting Player in the current Battle, ordered from most recent to least recent, with each Move_Block listed at most once.
3. WHEN a Move_Input_Window opens, THE Recommendation_Engine SHALL deliver the recommended Moves to the Game_Client within 500 milliseconds of the Move_Input_Window opening.
4. WHEN the Player selects a recommended or previous Move while the Move_Input_Window is open, THE Turn_Manager SHALL submit the stored Move_Block of that Move to the Move_Validator for the current Stage and SHALL NOT invoke the Move_Generator.
5. WHILE the Move_Input_Window is open and the Move_Prompt contains at least 1 non-whitespace character, THE Recommendation_Engine SHALL replace the recommended Moves with up to 5 Move_Library entries, ordered from highest to lowest Similarity_Score against the current Move_Prompt text. The update SHALL arrive within 300 milliseconds after the Player's last keystroke.
6. IF the Recommendation_Engine fails to deliver recommended Moves within 500 milliseconds, or returns an error, THEN THE Game_Client SHALL show an indication that recommendations are unavailable, SHALL keep showing the Player's previous Moves, and SHALL keep accepting Move_Prompt text input for the rest of the Move_Input_Window.
7. IF the Move_Library has no entries, or the acting Player has used no Moves in the current Battle, THEN THE Game_Client SHALL show an indication that the matching list is empty and SHALL keep accepting Move_Prompt text input.
8. IF the Move_Validator decides that a selected stored Move_Block cannot be executed on the current Stage, THEN THE Game_Client SHALL show an error message saying the selected Move cannot be executed on the current Stage. THE Game_Client SHALL keep the Move_Input_Window open for its remaining time, with the Player's Move_Prompt text and the other listed Moves unchanged.

### Requirement 9: Move Generation from Free Text

**User Story:** As a Player, I want to describe a new move in plain words and see it happen, so that I can invent creative attacks like hair clones or arrow volleys.

#### Acceptance Criteria

1. WHEN the Move_Library lookup for an accepted Move_Prompt returns no Move_Library entry with a Similarity_Score at or above the Reuse_Threshold, THE Move_Generator SHALL produce exactly one new Move_Block from that Move_Prompt.
2. THE Move_Generator SHALL compose every Move_Block from at least one registered Move_Primitive, with every parameter value inside the range that the Move_Block_Schema defines for that parameter, so that the Move_Block conforms to the Move_Block_Schema.
3. WHEN the Move_Generator receives an accepted Move_Prompt, THE Move_Generator SHALL return a Move_Block within 3 seconds, measured from the moment the Move_Generator receives the Move_Prompt to the moment the Move_Block is returned.
4. IF the Move_Generator does not return a Move_Block within 3 seconds of receiving the Move_Prompt, THEN THE Turn_Manager SHALL use the Move_Library entry with the highest Similarity_Score to the Move_Prompt for the Turn, SHALL use a Fallback_Move instead when the Move_Library contains zero entries, and SHALL discard any Move_Block the Move_Generator returns for that Move_Prompt after the 3-second limit.
5. IF a Move_Prompt describes one or more effects that no combination of registered Move_Primitives can express, THEN THE Move_Generator SHALL return a Move_Block that conforms to the Move_Block_Schema and contains only the described effects that registered Move_Primitives can express, together with a note of at most 200 characters that names each described effect that was omitted or substituted.
6. WHEN the Move_Generator produces a Move_Block, THE Move_Generator SHALL attach to the Move_Block a display name of 1 to 40 characters and a description consisting of exactly one sentence of at most 150 characters.
7. WHEN the Move_Generator returns a Move_Block with a note under criterion 5, THE Game_Client SHALL display the note to the acting Player before the Move animation starts and SHALL keep the note visible for at least 3 seconds.
8. IF the Move_Generator returns an error or returns a Move_Block that does not conform to the Move_Block_Schema, THEN THE Turn_Manager SHALL discard that output and apply the same substitution as criterion 4: the Move_Library entry with the highest Similarity_Score to the Move_Prompt, or a Fallback_Move when the Move_Library contains zero entries.

### Requirement 10: Guardrail Moderation

**User Story:** As a Player, I want offensive moves blocked instantly, so that battles stay respectful toward the mythology and toward other players.

#### Acceptance Criteria

1. WHEN a Move_Prompt is submitted, THE Guardrail SHALL classify the Move_Prompt within 200 milliseconds of submission as either acceptable or Derogatory_Content. A Derogatory_Content classification SHALL carry exactly one rejection category from this set: hate speech, slurs, harassment, sexual content, demeaning depiction of religious or cultural figures, or graphic gore.
2. WHEN the Move_Generator produces a Move_Block, THE Guardrail SHALL classify the display name and the description of the Move_Block as acceptable or Derogatory_Content within 200 milliseconds and before the Game_Client displays either text to any Player or Spectator.
3. IF the Guardrail classifies an original Move_Prompt as Derogatory_Content, THEN THE Guardrail SHALL produce exactly one rewritten Move_Prompt within 500 milliseconds of that classification. The rewritten Move_Prompt SHALL keep the same target Puppet_Character and the same combat action type as the original and SHALL remove the text that caused the classification.
4. IF the Guardrail classifies a rewritten Move_Prompt as Derogatory_Content, THEN THE Turn_Manager SHALL perform a Fallback_Move for the acting Puppet_Character without attempting a second rewrite.
5. IF the Guardrail cannot produce a rewritten Move_Prompt within 500 milliseconds of classifying the original Move_Prompt as Derogatory_Content, THEN THE Turn_Manager SHALL perform a Fallback_Move for the acting Puppet_Character.
6. WHEN the Guardrail rewrites a Move_Prompt or the Turn_Manager substitutes a Fallback_Move for moderation reasons, THE Game_Client SHALL show only the acting Player a notification that identifies the substitution type (rewritten Move_Prompt or Fallback_Move) and the rejection category. The notification SHALL appear before the Move animation starts.
7. IF the Guardrail is unavailable, or does not return a classification within 200 milliseconds for any Move_Prompt, rewritten Move_Prompt, display name, or description, THEN THE Turn_Manager SHALL treat the text as rejected and perform a Fallback_Move for the acting Puppet_Character.
8. THE Move_Library SHALL store only Move_Blocks whose Move_Prompt, display name, and description the Guardrail classified as acceptable. A Move_Block that came from a rewritten Move_Prompt SHALL be stored with the rewritten Move_Prompt, never the original.
9. WHEN the Guardrail rejects a Move_Prompt, rewritten Move_Prompt, display name, or description, THE Guardrail SHALL write a moderation log entry containing the rejection category, a timestamp, the rejected text, and an indication of which of these four text types was rejected.
10. IF the Guardrail classifies the display name or the description of a Move_Block as Derogatory_Content, THEN THE Turn_Manager SHALL discard that Move_Block without displaying or storing it and SHALL perform a Fallback_Move for the acting Puppet_Character.
11. WHEN the Guardrail classifies a Move_Prompt as Derogatory_Content, THE Game_Client SHALL withhold the original Move_Prompt text from every Player and Spectator other than the acting Player.
12. WHEN the Guardrail produces a rewritten Move_Prompt, THE Guardrail SHALL classify the rewritten Move_Prompt within 200 milliseconds, before the Move_Generator receives it.

### Requirement 11: Physics Validation of Moves

**User Story:** As a Player, I want every generated move checked against real physics, so that moves behave consistently and cannot break the game.

#### Acceptance Criteria

1. WHEN a Move_Block is resolved for a Turn, THE Move_Validator SHALL simulate the Move_Block in the Physics_Engine against the current Stage and Puppet_Character states before the Game_Client animates the Move. This applies whether the Move_Block was retrieved from the Move_Library or produced by the Move_Generator.
2. THE Move_Validator SHALL finish each validation pass of a Move_Block within 500 milliseconds. The time is measured from receipt of the Move_Block to the valid or invalid decision. The initial pass and the post-clamp pass each have their own 500-millisecond limit.
3. IF a validation pass does not reach a valid or invalid decision within 500 milliseconds, THEN THE Move_Validator SHALL stop the simulation and mark the Move_Block invalid.
4. IF the simulation produces a non-finite body position or velocity at any simulation step, exceeds 200 simultaneously spawned bodies, or exceeds a simulated duration of 8 seconds of simulation time, THEN THE Move_Validator SHALL mark the Move_Block invalid.
5. IF the Move_Validator marks a Move_Block invalid and one or more Move_Primitive parameters lie outside the minimum and maximum values defined in the Move_Block_Schema, THEN THE Move_Validator SHALL clamp each such parameter to its nearest schema bound and validate the clamped Move_Block exactly one more time.
6. IF a Move_Block remains invalid after the clamped validation pass, or is marked invalid with no parameter outside its Move_Block_Schema range, THEN THE Turn_Manager SHALL perform a Fallback_Move for the acting Puppet_Character within the same Turn and SHALL NOT store the invalid Move_Block in the Move_Library.
7. WHEN the Move_Validator marks a Move_Block valid, THE Move_Validator SHALL output one simulated hit result for every Puppet_Character in the Battle, for use by the Damage_Scorer. Each hit result SHALL contain an integer contact count of 0 or greater and a finite total impulse of 0 or greater. A Puppet_Character that was not hit SHALL get a hit result with a contact count of 0 and a total impulse of 0.
8. WHILE the Move_Validator is simulating a Move_Block, THE Move_Validator SHALL leave the live Stage and Puppet_Character states unchanged, including Health_Points, body positions and velocities, and the set of bodies on the Stage.
9. WHEN the Move_Validator marks a Move_Block valid, THE Game_Client SHALL animate exactly the Move_Block that passed validation, including any clamped parameter values, from the same starting state and random seed used in validation.
10. THE Move_Validator SHALL produce identical simulated hit results, meaning identical contact counts and total impulses for every Puppet_Character, whenever it validates the same valid Move_Block from an identical starting state with an identical random seed.

### Requirement 12: Modular Move Blocks

**User Story:** As a developer, I want moves defined as composable blocks of reusable primitives, so that new moves need no new code and parts can be swapped easily.

#### Acceptance Criteria

1. THE Move_Block_Schema SHALL define each Move_Block as a schema version, a display name of 1 to 40 characters, a description of 1 to 280 characters, an ordered list of 1 to 10 Move_Primitive invocations where each invocation names one registered Move_Primitive and supplies parameter values, and target selection rules that identify which Puppet_Characters the Move affects.
2. WHEN the Game_Client executes a Move_Block, THE Game_Client SHALL invoke only registered Move_Primitives, in the order listed in the Move_Block, without generating or executing new program code at runtime.
3. WHEN a developer registers a new Move_Primitive with a unique name, a parameter schema, and an implementation, THE Move_Generator SHALL include the new Move_Primitive in the set of Move_Primitives available to every Move_Block generated after the registration completes.
4. WHEN a developer registers a new Move_Primitive, THE Move_Parser and Move_Validator SHALL continue to accept every Move_Block that was stored in the Move_Library before the registration, with no change to those stored Move_Blocks.
5. WHEN one Move_Primitive invocation in a Move_Block is replaced with another invocation that names a registered Move_Primitive and supplies parameter values that conform to its parameter schema, THE Move_Validator SHALL validate the resulting Move_Block, and the other invocations in the Move_Block SHALL remain unchanged in content and order.
6. IF a Move_Block references an unregistered Move_Primitive or an unsupported schema version, THEN THE Move_Parser SHALL reject the whole Move_Block with an error that names the unknown Move_Primitive or schema version, and THE Game_Client SHALL execute no part of the rejected Move_Block.
7. IF a Move_Primitive invocation in a Move_Block omits a required parameter, supplies a parameter of the wrong type, or supplies a value outside the range set by that Move_Primitive's parameter schema, THEN THE Move_Parser SHALL reject the whole Move_Block with an error that identifies the position of the invocation in the list and the name of the non-conforming parameter.
8. IF a Move_Block contains 0 Move_Primitive invocations or more than 10, or has a display name or description outside the lengths defined in criterion 1, THEN THE Move_Parser SHALL reject the Move_Block with an error that identifies the field that violates the limit.
9. IF a developer registers a Move_Primitive under a name that is already registered, THEN THE Game_Client SHALL reject the registration with an error that names the duplicate, and the existing Move_Primitive registration SHALL remain unchanged.

### Requirement 13: Move Block Parsing and Printing

**User Story:** As a developer, I want Move_Blocks stored as a well-defined serialized document, so that they can be saved, shared, and reloaded without loss.

#### Acceptance Criteria

1. WHEN a serialized Move_Block document that conforms to the Move_Block_Schema and is no larger than 64 KB is provided, THE Move_Parser SHALL return a Move_Block object containing the schema version, display name, description, the Move_Primitive invocations in their document order with all parameter values, and the target selection rules from the document, within 50 milliseconds.
2. IF a serialized Move_Block document does not conform to the Move_Block_Schema (malformed syntax, a missing required field, a field of the wrong type, or a parameter value outside the range defined by the Move_Block_Schema), THEN THE Move_Parser SHALL return an error that identifies the location (field path, or line and column for malformed syntax) and the reason of the first nonconformance, and SHALL return no Move_Block object, not even a partial one.
3. WHEN a valid Move_Block object is provided, THE Move_Printer SHALL return a serialized Move_Block document that conforms to the Move_Block_Schema and contains every field of the Move_Block object, with the Move_Primitive invocations in the same order as in the object.
4. FOR ALL valid Move_Block objects, printing with the Move_Printer then parsing with the Move_Parser SHALL produce an equivalent Move_Block object (round-trip property), where equivalent means the same schema version, display name, description, and target selection rules, the same number of Move_Primitive invocations in the same order, and identical Move_Primitive names and parameter values for each invocation.
5. IF a serialized Move_Block document is larger than 64 KB, THEN THE Move_Parser SHALL reject the document without parsing it and return an error indicating that the size limit was exceeded.
6. IF the Move_Printer receives a Move_Block object that does not conform to the Move_Block_Schema, THEN THE Move_Printer SHALL return an error that identifies the first nonconforming field and SHALL return no serialized document.
7. WHEN the Move_Printer formats two equivalent Move_Block objects, THE Move_Printer SHALL return byte-identical serialized Move_Block documents (deterministic output).

### Requirement 14: Move Library with Similarity Reuse

**User Story:** As a Player, I want similar move requests answered from a library of saved moves, so that moves resolve fast and the system does not regenerate the same move each time.

#### Acceptance Criteria

1. WHEN a Move_Block passes validation by the Move_Validator and moderation by the Guardrail, THE Move_Library SHALL store, in one entry, the Move_Block, the embedding of the originating Move_Prompt, the identifier of the Player who created it, the creation time, and a usage count of 0. The stored entry SHALL be retrievable by later queries, including queries in later Battles.
2. WHEN the Guardrail accepts a Move_Prompt, THE Move_Library SHALL return, within 200 milliseconds of receiving the query, the single entry with the highest Similarity_Score together with that Similarity_Score, a value from 0.0 to 1.0. If two or more entries tie on the highest Similarity_Score, THE Move_Library SHALL return the tied entry with the highest usage count, and if usage counts are also equal, the tied entry with the earliest creation time. If the Move_Library contains no entries, THE Move_Library SHALL return no entry and a Similarity_Score of 0.0.
3. IF the highest returned Similarity_Score is greater than or equal to the Reuse_Threshold, THEN THE Turn_Manager SHALL use the returned Move_Library entry for the Turn and SHALL NOT invoke the Move_Generator to create a new Move_Block.
4. IF a reused Move_Library entry has quantities or targets that differ from those in the Move_Prompt (for example "50 arrows" versus "10 arrows" in the entry), THEN THE Move_Generator SHALL change only the parameter values of the stored Move_Block to match the Move_Prompt, SHALL keep the same Move_Primitives in the same order, and SHALL clamp each changed value to the minimum or maximum allowed by the Move_Block_Schema. THE Move_Validator SHALL then validate the adjusted Move_Block before the Turn uses it, and the stored entry SHALL remain unchanged.
5. WHEN a Move_Library entry is executed in a Turn, either as stored or with adjusted parameters, THE Move_Library SHALL increase the usage count of that entry by exactly 1.
6. IF a Move_Block is submitted for storage that is equivalent to an existing Move_Library entry, meaning it has the same Move_Primitives in the same order with identical parameter values, THEN THE Move_Library SHALL keep exactly one entry, SHALL link the new Move_Prompt to the existing entry, and SHALL leave the existing entry's creator and creation time unchanged (idempotence).
7. WHEN the Move_Library is queried with Move_Prompt text that exactly matches, character for character, the originating or a linked Move_Prompt of a stored entry, THE Move_Library SHALL return that entry with a Similarity_Score of 1.0.
8. IF the highest returned Similarity_Score is less than the Reuse_Threshold, THEN THE Turn_Manager SHALL invoke the Move_Generator to create a new Move_Block from the Move_Prompt.
9. IF the Move_Library returns no result within 200 milliseconds of the query, or returns an error, THEN THE Turn_Manager SHALL treat the query as having no match, SHALL invoke the Move_Generator for the Move_Prompt, and SHALL keep the current Turn and Move_Input_Window running.
10. IF storing an accepted Move_Block in the Move_Library fails, THEN THE Turn_Manager SHALL still execute the accepted Move in the current Turn, and THE Move_Library SHALL contain no partial entry for that Move_Block.

### Requirement 15: Damage Scoring

**User Story:** As a Player, I want damage decided fairly from several criteria, so that clever, fitting, and popular moves are rewarded.

#### Acceptance Criteria

1. WHEN a Voting_Window closes, THE Damage_Scorer SHALL compute a Damage_Score for the Move within 5 seconds, using four inputs: the simulated hit results from the Physics_Engine, the Creativity_Score (0.0 to 1.0), a Trait alignment value from 0.0 to 1.0 that rates how well the Move matches the acting Puppet_Character's Traits, and the Vote_Share (0.0 to 1.0).
2. THE Damage_Scorer SHALL produce each Damage_Score as an integer from 0 to 30 inclusive.
3. WHEN the acting Player uses the same Move_Library entry more than once in the current Battle, THE Damage_Scorer SHALL compute a Creativity_Score for each repeat use that is strictly lower than the Creativity_Score computed for that entry's previous use by that Player in the Battle, unless the previous Creativity_Score was already 0.0, in which case the Creativity_Score SHALL be 0.0.
4. WHEN the Damage_Scorer computes a Damage_Score, THE Game_Client SHALL show the acting Player and the target Player, within 1 second, the Damage_Score and the contribution of each of the four criteria (hit results, Creativity_Score, Trait alignment, Vote_Share), and SHALL keep this display visible for at least 3 seconds.
5. FOR ALL Moves with identical hit results, Creativity_Score, Trait alignment, and Vote_Share, THE Damage_Scorer SHALL produce identical Damage_Scores (determinism).
6. FOR ALL pairs of Moves that differ only in Vote_Share, THE Damage_Scorer SHALL produce a Damage_Score for the higher Vote_Share that is greater than or equal to the Damage_Score for the lower Vote_Share (monotonicity).
7. IF the simulated hit results show no contact between the Move and the target Puppet_Character, THEN THE Damage_Scorer SHALL produce a Damage_Score of 0, regardless of the Creativity_Score, Trait alignment, and Vote_Share.
8. WHEN the Damage_Scorer produces a Damage_Score, THE Turn_Manager SHALL reduce the target Puppet_Character's Health_Points by the Damage_Score, with a minimum resulting value of 0.
9. IF zero Spectator votes are cast during the Voting_Window, THEN THE Damage_Scorer SHALL use a Vote_Share of 0.5 when computing the Damage_Score.
10. IF the Damage_Scorer fails or does not produce a Damage_Score within 5 seconds of the Voting_Window closing, THEN THE Damage_Scorer SHALL produce a Damage_Score from 0 to 30 using only the simulated hit results, the same hit results SHALL always give the same Damage_Score in this case, and THE Game_Client SHALL tell the acting Player and the target Player that the fallback calculation was used.

### Requirement 16: Public Voting

**User Story:** As a Spectator, I want to vote on each move, so that the audience can influence which moves hit hardest.

#### Acceptance Criteria

1. WHERE public voting is enabled for a Battle, WHEN a Move animation finishes, THE Voting_Service SHALL open a Voting_Window for that Move that lasts for the configured Voting_Window duration, which must be between 1 and 60 seconds inclusive and defaults to 10 seconds.
2. WHERE public voting is enabled for a Battle, WHILE a Voting_Window is open, WHEN a Spectator submits a vote on the Move, THE Voting_Service SHALL accept the vote only if it is either a positive rating or a negative rating of that Move.
3. WHERE public voting is enabled for a Battle, IF a Spectator submits a second or later vote on the same Move, THEN THE Voting_Service SHALL reject the vote, keep the Spectator's first recorded vote unchanged, and tell the Spectator that a vote has already been cast for that Move.
4. WHERE public voting is enabled for a Battle, WHILE a Voting_Window is open, THE Game_Client SHALL show Spectators the remaining Voting_Window time in whole seconds and update it at least once per second.
5. WHERE public voting is enabled for a Battle, IF a Player who controls a Puppet_Character in the Battle submits a vote, THEN THE Voting_Service SHALL reject the vote, leave it out of the Vote_Share, and tell the Player that combatants cannot vote.
6. WHERE public voting is enabled for a Battle, IF a Spectator submits a vote for a Move whose Voting_Window is not open, THEN THE Voting_Service SHALL reject the vote, leave it out of the Vote_Share, and tell the Spectator that voting for that Move is closed.
7. WHERE public voting is enabled for a Battle, WHEN a Voting_Window closes with at least one accepted vote, THE Voting_Service SHALL report to the Damage_Scorer a Vote_Share equal to the number of accepted positive votes divided by the total number of accepted votes for that Move.
8. WHERE public voting is enabled for a Battle, IF no votes are accepted during a Voting_Window, THEN THE Voting_Service SHALL report a Vote_Share of 0.5 to the Damage_Scorer.
9. WHERE public voting is disabled for a Battle, THE Damage_Scorer SHALL use a Vote_Share of 0.5 for every Move.

### Requirement 17: Fallback Moves

**User Story:** As a Player, I want a sensible default move whenever my move cannot be used, so that the battle never stalls.

#### Acceptance Criteria

1. THE Turn_Manager SHALL keep a fixed set of between 3 and 20 pre-approved Fallback_Moves, each of which the Move_Validator has marked valid and the Guardrail has classified as acceptable (display name and description) before the Battle starts.
2. WHEN the Turn_Manager performs a Fallback_Move, THE Turn_Manager SHALL select the Fallback_Move with the highest Similarity_Score between its description and the name of the acting Puppet_Character's highest-magnitude Trait, breaking ties first by the Trait listed first in the Scenario and then by the Fallback_Move listed first in the fixed set.
3. WHEN the Turn_Manager performs a Fallback_Move, THE Turn_Manager SHALL start the Fallback_Move animation within 500 milliseconds of the event that caused the substitution.
4. WHEN the Turn_Manager performs a Fallback_Move, THE Damage_Scorer SHALL compute the Damage_Score with a Creativity_Score of 0.0.
5. WHEN the Turn_Manager performs a Fallback_Move, THE Game_Client SHALL show the acting Player a message for at least 3 seconds that names the Fallback_Move and states which of these substitution reasons applied: the Move_Input_Window ended with no input, the Move_Generator timed out while the Move_Library was empty, the Guardrail rejected the Move_Prompt, the Guardrail was unavailable or did not respond within 200 milliseconds, or the Move_Block stayed invalid after clamping.
6. IF the Move_Validator marks the selected Fallback_Move invalid on the current Stage, THEN THE Turn_Manager SHALL try the remaining Fallback_Moves in descending Similarity_Score order and perform the first one that the Move_Validator marks valid.
7. IF the Move_Validator marks every Fallback_Move invalid on the current Stage, THEN THE Turn_Manager SHALL end the Turn with a Damage_Score of 0, leave every Puppet_Character's Health_Points unchanged, and pass the next Turn to the next Player in Turn order.
8. WHEN the Turn_Manager performs a Fallback_Move, THE Move_Library SHALL leave its stored Move_Blocks unchanged by that Fallback_Move.

### Requirement 18: Turn Latency Budget

**User Story:** As a Player, I want my move to start playing soon after I submit it, so that the battle feels responsive.

#### Acceptance Criteria

1. WHEN the Move_Input_Window closes with a Move_Prompt whose highest Move_Library Similarity_Score is at or above the Reuse_Threshold, THE Turn_Manager SHALL start the Move animation within 1 second, measured from the moment the Move_Input_Window closes to the first rendered frame of the Move animation, covering Guardrail moderation, Move_Library lookup, and Move_Validator validation.
2. WHEN the Move_Input_Window closes with a Move_Prompt whose highest Move_Library Similarity_Score is below the Reuse_Threshold, THE Turn_Manager SHALL start the Move animation within 4 seconds, measured from the moment the Move_Input_Window closes to the first rendered frame of the Move animation, covering Guardrail moderation, Move_Library lookup, Move_Generator generation, and Move_Validator validation.
3. WHILE the Turn_Manager is waiting for the Guardrail, Move_Library, Move_Generator, or Move_Validator to finish processing the acting Player's Move, THE Game_Client SHALL display a looping waiting animation of the acting Puppet_Character on the Stage. The waiting animation SHALL start within 100 milliseconds after the Move_Input_Window closes and SHALL stop when the first frame of the Move animation is rendered.
4. WHEN the Move_Input_Window closes with a recommended or previous Move selected by the Player, THE Turn_Manager SHALL start the Move animation within 1 second after the Move_Input_Window closes.
5. IF a Move_Block has not passed validation by the Move_Validator within the 1-second or 4-second budget that applies to the Move, THEN THE Turn_Manager SHALL discard that Move_Block, perform a Fallback_Move for the acting Puppet_Character, and start the Fallback_Move animation within 500 milliseconds after the budget expires.
6. WHEN the Turn_Manager performs a Fallback_Move because the Move_Input_Window closed with no input, or because moderation or validation rejected the Move, THE Turn_Manager SHALL start the Fallback_Move animation within 1 second after the Move_Input_Window closes.
