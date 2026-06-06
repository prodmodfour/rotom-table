This is a Nuxt 3 and three.js project.

## Production deployment boundaries

When fixing production issues, modify this repository and validate locally/prodlike. Do not directly edit, copy files into, rebuild, restart, or otherwise change the production app runtime as a code deployment mechanism. Production app-code deployment is handled by the user through the project's GitHub-based deployment path.

## Software Practices
When writing software, we explicitly always adhere to the following principles:
  - Single Responsibility Principle
  - Open/Closed Principle
  - Liskov Substitution Principle
  - Interface Segregation Principle
  - Dependency Inversion Principle
  - DRY principle
  - Law of Demeter

  Viiolations of these principles should be seen as codebase corruption. If you spot violations while doing work, ensure that you clean up corruption in order to keep a pure codebase.
