---
modulo: coaching
metodologia: Gestión ágil básica (Scrum y Kanban)
origen: Jeff Sutherland y Ken Schwaber (Scrum); David J. Anderson (Kanban)
dispara_cuando: [equipo_desorganizado_con_tareas, no_se_priorizar_el_trabajo_del_equipo, exceso_de_trabajo_en_curso, falta_de_visibilidad_del_progreso]
fragmento_relacionado: eisenhower-rapid
---

## Metodología / técnica
Fundamentos de gestión ágil — Scrum y Kanban

## Autor y origen
Scrum fue formalizado por Jeff Sutherland y Ken Schwaber; Kanban como método de gestión de flujo de trabajo fue adaptado al contexto de conocimiento por David J. Anderson, basándose en el sistema de producción de Toyota.

## Cuándo se aplica
Cuando un manager no técnico gestiona un equipo con exceso de tareas simultáneas sin visibilidad clara del progreso, o cuando el equipo se queja de estar "siempre apagando fuegos" sin margen para planificar, incluso sin ser un equipo de desarrollo de software (estos marcos se han extendido mucho más allá de ese origen).

## Síntesis en tus palabras
Ambos métodos resuelven un mismo problema de fondo —demasiado trabajo en curso a la vez, sin visibilidad ni ritmo— pero con enfoques distintos. **Scrum** trabaja en ciclos fijos y cortos (sprints, normalmente de una a dos semanas): al principio del ciclo se decide qué se va a completar, y al final se revisa qué se logró y qué no, sin añadir trabajo nuevo a mitad del ciclo salvo excepción justificada. Su valor principal es crear un ritmo predecible y proteger al equipo de la interrupción constante durante el ciclo — el problema, cuando se implementa mal, es tratar el sprint como algo rígido e inamovible en vez de como un marco de foco temporal.

**Kanban** no usa ciclos fijos, sino un tablero visual de columnas (por hacer, en curso, hecho, u otras según el flujo real) con un límite explícito de cuántas tareas pueden estar "en curso" a la vez (WIP limit — Work In Progress). Este límite es la pieza más importante y la más ignorada: sin él, un equipo acumula muchas tareas empezadas y ninguna terminada, lo que se siente como progreso ("estamos trabajando en todo") pero en realidad ralentiza la entrega de cada cosa individual. Forzar el límite de trabajo en curso —aunque incomode al principio, porque implica decir explícitamente "no" a empezar algo nuevo— es lo que realmente acelera la entrega real, de forma contraintuitiva.

La elección entre ambos depende del tipo de trabajo: Scrum encaja mejor cuando el trabajo se puede agrupar en entregables por ciclo; Kanban encaja mejor cuando el trabajo llega de forma continua e impredecible (soporte, peticiones ad hoc) y no tiene sentido forzarlo en ciclos artificiales.

## Cómo se ofrece en conversación
> "Lo que describes —siempre con muchas cosas empezadas y pocas terminadas— tiene una causa muy identificada en gestión ágil: demasiado trabajo en curso a la vez. La solución no intuitiva es poner un límite explícito a cuántas cosas puede tener el equipo 'en marcha' simultáneamente —lo llaman WIP limit en Kanban— y decir que no a empezar algo nuevo hasta que algo termine. Suena contraproducente al principio, pero es justo lo que acelera la entrega real, en vez de tener veinte cosas al 50%."

## Notas para quien mantenga este contenido
- Conecta con "eisenhower-rapid" para la priorización previa de qué entra al tablero en primer lugar — la gestión ágil organiza el flujo, pero no decide qué es importante, eso viene de otro marco.
- Mantener el lenguaje accesible para managers no técnicos — evitar jerga excesiva de desarrollo de software, ya que estos marcos se aplican hoy en marketing, RRHH, operaciones, etc.
