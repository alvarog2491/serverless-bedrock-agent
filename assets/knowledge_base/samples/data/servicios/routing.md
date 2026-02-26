---
title: Routing de intenciones
tags: [servicios, intent, cotizacion, cursos, marketing]
locale: es-ES
source: knowledge_base
topic: servicios
---

# Routing de intenciones de Medif Estructuras

Este documento actúa como guion para el chatbot: cada sección describe qué camino seguir cuando el usuario manifiesta una intención específica (curso, asesoría, cotización, marketing, foro o YouTube). Las frases se pueden recuperar por similitud y ayudan a mantener la conversación alineada con las reglas del negocio.

## Intención: cotización de proyectos
- Confirmar que sí hacemos diseños estructurales, arquitectónicos, hidrosanitarios y contra incendios.
- Recordar los rangos: 3-7 USD/m² (arquitectura), 0,5-3 USD/m² (estructuras), 1 USD/m² (hidrosanitario o contra incendios).
- Pedir planos, ubicación, normativa, niveles y plazos; derivar todo a `eduardo.mediavilla@medifestructuras.com`.
- Mencionar el link de pago único de Stripe y sugerir usar “Enviar mis datos” para recibirlo.
- No remitir a archivos internos ni decir “dependiendo del servicio”; siempre dar rangos concretos.

## Intención: cursos y formación
- Informar que hay 9 cursos (8 estructuras, 1 instalaciones) y el mejor para comenzar es "Curso de Estructuras de Hormigón Armado con CYPECAD y CYPE 3D".
- Preguntar o deducir nivel (estudiante, profesional) y recomendar iterar.
- Compartir el enlace https://medifestructuras.com/formacion/ y el canal de YouTube como recursos gratuitos.
- Indicar que las inscripciones habilitan el foro y que el link Stripe es el método de pago; se puede solicitar por el mismo correo o “Enviar mis datos”.

## Intención: asesorías técnicas
- Confirmar sesiones de 2 horas para revisar proyectos, validar modelos y corregir errores en CYPE/SAP2000/ETABS.
- Solicitar descripción técnica, software usado, archivos de trabajo y plazo.
- Derivar a `eduardo.mediavilla@medifestructuras.com` y recordar el link de pago.

## Intención: servicios digitales (marketing + chatbots)
- Afirmar que Medif Estructuras ofrece Google Ads, Facebook Ads, LinkedIn Ads, SEO y chatbots/agents IA (Ollama + vector DB).
- Reforzar precio referencial 350 USD/mes y el link Stripe como único medio de pago.
- Invitar a contactar por correo o WhatsApp +357 968 632 57 y usar “Enviar mis datos” para coordinar.

## Intención: foro de alumnos y recuperación de credenciales
- Explicar que el foro es exclusivo para alumnos, 1 bloque por curso. Se habilita tras matricularse y la contraseña se recupera con el enlace “Olvidaste tu contraseña?” en la plataforma.
- En caso de perder la clave, indicar el proceso de recuperación automática y que no se necesita enviar correos extra.

## Intención: YouTube y contenido gratuito
- Derivar siempre al canal `https://www.youtube.com/@medifestructuras` cuando pregunten por YouTube o recursos gratuitos.
- Mencionar que el canal sirve como apoyo educativo, introducción a temas avanzados y puerta a los cursos/asesorías.

## Intención: contacto y datos del usuario
- Siempre sugerir enviar datos usando el botón “Enviar mis datos” o escribiendo teléfono/correo en el chat para avanzar con el proceso.
- Agradecer cuando el usuario comparte datos de contacto y confirmar que se guardaron sin iniciar búsqueda en RAG.

Este routing ayuda a que cualquier chunk recuperado pueda autopreguntar “¿Qué intención necesita este usuario?” y ofrecer los pasos exactos.
