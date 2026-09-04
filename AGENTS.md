You are acting as a senior gameplay programmer building an INTERNAL GREYBOX PROTOTYPE for studying endless-runner / jetpack-flight mechanics.

I do NOT want polished art, production UI, copyrighted assets, branding, characters, sounds, or a visual recreation of Jetpack Joyride.

The purpose of this project is to reverse-engineer and understand the GENERAL GAMEPLAY PRINCIPLES behind a side-scrolling jetpack endless runner so that I can later recreate the mechanics myself in a real game engine such as Godot, Unity, or another engine.

The prototype must prioritize:

1. Physics
2. Gameplay math
3. State visualization
4. Debugging tools
5. Tweakability
6. Understanding WHY each mechanic works

Do not prioritize graphics.

## TECHNOLOGY

Build this as a browser application using:

- TypeScript
- HTML5 Canvas
- Vite if needed
- Minimal dependencies

Do NOT use Phaser, Matter.js, Pixi physics, or another game engine/physics engine unless absolutely necessary.

I specifically want the important movement, collision, spawning, and gameplay mathematics implemented manually so I can inspect them.

Use a clean project structure.

Example:

src/
game/
Game.ts
Player.ts
Physics.ts
Collision.ts
Camera.ts
World.ts
Spawner.ts
Difficulty.ts
debug/
DebugRenderer.ts
DebugPanel.ts
Telemetry.ts
config/
gameplayConfig.ts
main.ts

Architecture can differ if you have a better professional structure.

---

# CORE GAMEPLAY

Create a greybox endless side-scrolling game inspired by the GENERAL MECHANICAL MODEL of games like Jetpack Joyride.

The player automatically travels toward the right side of the world.

However, preferably implement this using the common endless-runner technique where:

- the player's horizontal position remains approximately stable on screen
- the world moves toward the player
- gameplay is driven by a world scroll speed

Explain why this architecture is commonly used.

The player controls vertical movement using one input:

HOLD:
jetpack thrust is applied upward.

RELEASE:
gravity pulls the player downward.

The mechanic must feel responsive while still having believable acceleration and inertia.

Do NOT simply move the player upward by a fixed amount each frame.

Implement actual velocity and acceleration.

Something conceptually similar to:

velocityY += gravity \* dt

when thrusting:

velocityY += thrustAcceleration \* dt

positionY += velocityY \* dt

But determine the correct implementation and explain it.

The simulation MUST be frame-rate independent using delta time.

---

# PLAYER PHYSICS

Expose and make adjustable at runtime:

gravity

jetpack thrust acceleration

maximum upward velocity

maximum falling velocity

starting vertical velocity

player mass if relevant

drag / damping if used

terminal velocity

player collider width

player collider height

floor height

ceiling height

collision response

input responsiveness

thrust startup behavior

thrust cutoff behavior

world scroll speed

maximum world scroll speed

acceleration of world speed

Explain which values actually matter mathematically and which exist mostly for game feel.

---

# IMPORTANT: PHYSICS VISUALIZATION

I want to SEE the invisible systems.

Create a DEBUG OVERLAY that can display:

Player position:
x
y

Velocity:
vx
vy

Acceleration:
ax
ay

Gravity vector

Jetpack thrust vector

Net acceleration vector

Player collider

Floor collider

Ceiling collider

Obstacle colliders

Current delta time

FPS

World scroll speed

Distance traveled

Current difficulty multiplier

Current player state

Current input state

Current obstacle spawn timer

Distance to next obstacle

Random seed if applicable

Draw velocity and acceleration vectors directly on the player.

Example:

green line = velocity vector
yellow line = thrust
another line = gravity

Use labels so I know what I'm looking at.

---

# DEBUG PANEL / GAMEPLAY LAB

Create an always-accessible developer panel.

This prototype should feel like an INTERNAL GAMEPLAY TESTING TOOL rather than a finished game.

The panel should allow me to change variables LIVE while playing.

I want sliders / number inputs for variables such as:

Gravity
Thrust
Maximum ascent velocity
Maximum fall velocity
World speed
World acceleration
Obstacle frequency
Obstacle spacing
Obstacle size
Player collider size
Difficulty rate
Random seed

Changing them should immediately affect the simulation.

Include:

PAUSE

RESUME

RESET

RESTART WITH SAME SEED

RESTART WITH RANDOM SEED

FRAME STEP

SLOW MOTION

Simulation speed:
0.1x
0.25x
0.5x
1x
2x

A single-frame step button is especially important.

---

# PRESETS

Add several physics presets.

For example:

Floaty
Balanced
Heavy
Very Responsive
High Gravity
Low Gravity

The presets should only modify gameplay variables.

Show me exactly which numerical parameters each preset changes.

Allow saving / copying the current configuration as JSON.

Example:

{
"gravity": 1450,
"thrustAcceleration": -2200,
"maxRiseSpeed": -650,
"maxFallSpeed": 900
}

Also allow pasting a JSON configuration to restore values.

---

# OBSTACLE SYSTEM

Create SIMPLE GREYBOX obstacles.

Rectangles, lines, or basic primitives only.

Study the important obstacle relationships found in endless runners.

Implement examples such as:

horizontal hazards

vertical hazards

top hazards

bottom hazards

paired openings

moving hazards

temporary barriers

Do not focus on copying specific Jetpack Joyride obstacles.

Instead focus on understanding obstacle DESIGN MATHEMATICS.

Expose:

spawn distance

minimum spacing

maximum spacing

opening size

vertical position

movement speed

obstacle width

reaction time

safe corridor

randomness

---

# OBSTACLE DEBUGGING

For every obstacle show optional debug information:

Collider

Obstacle ID

Spawn position

Speed

Distance from player

Estimated time until reaching player

Available reaction time

Opening size

Whether the current player trajectory would collide with it

If possible, visually show the safe passage region.

---

# PROCEDURAL SPAWNING

Create an endless obstacle spawning system.

Do NOT just call Math.random() everywhere.

Create a deterministic seeded random generator so that the same seed generates the same obstacle sequence.

I want to be able to:

enter seed 12345

play

restart

and receive exactly the same obstacle sequence.

Explain why deterministic randomness is useful for gameplay development and QA.

---

# DIFFICULTY CURVE

Implement a simple difficulty manager.

Difficulty should increase gradually based on:

distance

time

or both

Potential variables:

scroll speed

obstacle frequency

obstacle spacing

opening size

moving obstacle speed

Do NOT make difficulty purely random.

Create a controllable difficulty function.

For example, conceptually:

difficulty = clamp(distance / someValue, 0, 1)

Then values can interpolate:

worldSpeed = lerp(startSpeed, maxSpeed, difficulty)

But choose the appropriate model.

Show the difficulty equations in comments and documentation.

Visualize the current difficulty value in real time.

---

# REACTION-TIME ANALYSIS

This is extremely important.

For each obstacle, calculate approximately how much reaction time the player has.

For example:

reactionTime = distanceToObstacle / worldSpeed

Show this number in the debug UI.

I want to understand relationships such as:

speed vs obstacle spacing

gravity vs opening size

jetpack acceleration vs required reaction time

maximum velocity vs obstacle positioning

Explain these relationships.

---

# COLLISION SYSTEM

Implement the collision logic manually.

Prefer simple:

AABB collision

or another transparent collision model.

Show collider geometry visually.

Explain:

broad phase if relevant

narrow phase if relevant

overlap tests

how fast-moving objects can potentially tunnel through colliders

whether fixed timestep simulation would improve stability

Include an optional visualization for collision contacts if reasonable.

---

# GAME LOOP

Use a professional game loop architecture.

Explain:

requestAnimationFrame

delta time

variable timestep

fixed timestep

physics update

render update

why physics simulations sometimes use a fixed timestep

If appropriate, implement a fixed physics timestep such as:

1 / 60 seconds

with an accumulator while rendering independently.

I specifically want to understand this because later I will transfer these principles into a game engine.

---

# STATE MACHINE

Use a small player/game state machine.

Possible states:

READY
RUNNING
DEAD
PAUSED

And player-specific states if useful:

FALLING
THRUSTING
FLOOR_CONTACT
CEILING_CONTACT

Display the current state on screen.

Do not create unnecessary architecture, but demonstrate how gameplay states would normally be handled professionally.

---

# TELEMETRY

Create a telemetry/debug section showing values over time.

At minimum show:

Y position
vertical velocity
vertical acceleration
world speed

Ideally provide simple scrolling graphs.

This will help me understand the actual motion instead of judging everything visually.

Allow telemetry to be enabled/disabled.

---

# TRAJECTORY PREVIEW

Add an optional trajectory prediction debug feature.

When enabled, simulate several future physics steps WITHOUT changing the real game state and draw the approximate future player path.

Show:

trajectory if the player RELEASES input

trajectory if the player CONTINUES HOLDING thrust

Use different line styles or labels.

This feature is for understanding the physics and should be disabled by default.

Explain how the prediction works.

---

# INPUT

Primary control:

Space
Mouse button
Touch / pointer

Holding input activates thrust.

Releasing removes thrust.

Show:

input pressed
input duration
time since released

in the debug UI.

---

# CAMERA / WORLD MODEL

Explain the distinction between:

player velocity

camera movement

world movement

screen coordinates

world coordinates

Even if this prototype uses a simplified endless-runner coordinate system, structure it cleanly enough that I understand those concepts.

---

# DEATH / RESET

For the first prototype:

collision with hazards = death.

When death occurs:

freeze or pause the simulation

highlight the collider that caused the collision

display:

player velocity at collision

world speed

obstacle ID

distance traveled

current difficulty

reaction time that obstacle originally provided

Then allow instant restart.

---

# PROFESSIONAL GREYBOX VISUAL STYLE

The game should visually look like an internal studio prototype.

Use:

rectangles

circles

lines

grid

collider outlines

debug text

simple neutral colors

NO polished character art

NO particle effects unless they demonstrate physics

NO elaborate menus

NO unnecessary animations

The player can literally be a rectangle with a small triangle / line showing thrust.

Obstacles can be rectangles.

The point is SYSTEM VISIBILITY.

---

# DEVELOPMENT DOCUMENTATION

Create a document inside the project:

MECHANICS.md

This is extremely important.

Explain the prototype as though you were teaching a junior gameplay programmer.

Document:

1. Main game loop
2. Player physics
3. Gravity
4. Jetpack thrust
5. Velocity integration
6. Delta time
7. Fixed timestep
8. World scrolling
9. Collision detection
10. Obstacle spawning
11. Seeded randomness
12. Difficulty progression
13. Reaction-time calculation
14. Trajectory prediction
15. Important tunable constants
16. How these concepts translate to game engines

For the engine translation section, explain conceptually what these systems would correspond to in:

Godot

Unity

but DO NOT implement those versions yet.

Example:

Browser prototype:
player.positionY += velocityY \* dt

Godot conceptual equivalent:
modify CharacterBody2D.velocity and call movement logic

Unity conceptual equivalent:
update Rigidbody2D velocity / forces

Explain concepts, not just API names.

---

# CODE COMMENTS

Do not comment obvious syntax.

Comment GAMEPLAY REASONING.

Bad comment:

// Add gravity

Good comment:

// Gravity is integrated into vertical velocity rather than directly
// modifying position. This preserves acceleration and allows thrust
// to oppose gravity naturally.

I want comments that teach WHY the implementation exists.

---

# IMPORTANT DEVELOPMENT RULE

Do not hide important mechanics behind unexplained helper functions.

For example, if there is:

calculateDifficulty()

I should be able to open that function and clearly see the equation.

If there is:

applyJetpackPhysics()

I should clearly see:

forces / acceleration
velocity integration
velocity clamping
position integration

The prototype should be readable enough that someone learning gameplay programming can trace one frame from INPUT → PHYSICS → COLLISION → GAME STATE → RENDER.

---

# DEBUG MODES

Add keyboard shortcuts if reasonable:

F1 = debug overlay

F2 = colliders

F3 = physics vectors

F4 = trajectory prediction

F5 = telemetry

P = pause

. = advance one simulation frame

R = restart

Do not interfere with browser refresh shortcuts.

Display the shortcuts somewhere in the debug UI.

---

# EXPERIMENTS

Add a section in MECHANICS.md called:

"Experiments to Try"

Give me experiments such as:

Experiment 1:
Double gravity but keep thrust unchanged.

Observe what happens to:

- equilibrium
- ascent
- fall speed
- reaction window

Experiment 2:
Double both gravity and thrust.

Explain why the game can feel more responsive even if the approximate movement envelope remains similar.

Experiment 3:
Increase world speed without changing obstacle spacing.

Observe the reduction in reaction time.

Experiment 4:
Increase fixed timestep from 1/60 to 1/20.

Observe collision / motion stability.

Create at least 10 useful experiments.

---

# PHYSICS QUESTIONS THE PROTOTYPE SHOULD HELP ANSWER

Design the implementation so I can investigate questions such as:

Why does holding the button cause the character to rise?

What exactly happens to vertical velocity when I release the button?

At what point does thrust overcome gravity?

What determines how quickly the player changes direction?

Why do high gravity + high thrust often feel more responsive than low gravity + low thrust?

How does maximum vertical velocity affect skill?

How does world velocity change obstacle difficulty?

How can designers calculate approximate reaction windows?

How does obstacle spacing relate to player acceleration capabilities?

How do you prevent impossible obstacle configurations?

How does delta time affect motion?

Why use a fixed physics timestep?

How does seeded procedural generation improve testing?

---

# IMPOSSIBLE OBSTACLE DETECTION

If feasible, add a basic experimental validator.

When generating an obstacle arrangement, estimate whether it is physically reachable based on:

player acceleration

current vertical velocity

available time

opening location

world speed

It does NOT need to be mathematically perfect.

The purpose is to demonstrate the concept of procedural-generation validation.

If an obstacle is considered potentially impossible:

mark it red in debug mode

log the reason

Example:

REJECTED:
required vertical displacement = 310px
estimated reachable displacement = 185px

Explain the approximation used.

---

# FINAL DELIVERABLE

Build a WORKING prototype, not just an explanation.

Once the first working version exists:

1. Run it.
2. Fix runtime and TypeScript errors.
3. Verify controls.
4. Verify reset.
5. Verify live tweaking.
6. Verify seeded generation.
7. Verify debug visualizations.
8. Verify collision.
9. Verify frame stepping.
10. Verify telemetry.
11. Verify trajectory preview.

Then give me a concise walkthrough of the project.

Show me:

which file controls player physics

which file controls difficulty

which file controls spawning

which file contains tunable values

where the game loop lives

where collisions are calculated

where debug rendering happens

Finally, explain exactly what happens during ONE simulation frame in order:

INPUT
→ GAMEPLAY LOGIC
→ PHYSICS
→ COLLISION
→ STATE UPDATE
→ WORLD UPDATE
→ DEBUG DATA
→ RENDER

Remember:

THIS IS NOT AN ART PROTOTYPE.

THIS IS A GAMEPLAY PROGRAMMING LAB.

Optimize for transparency, experimentation, mathematics, debugging, and learning.
