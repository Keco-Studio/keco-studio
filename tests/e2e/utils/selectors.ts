import type { Page, Locator } from '@playwright/test';

export function authSelectors(page: Page) {
  return {
    headingLogin: page.getByRole('heading', { name: /login/i }),
    headingRegister: page.getByRole('heading', { name: /register/i }),
    emailInput: page.getByLabel('Email'),
    usernameInput: page.getByLabel('Username'),
    passwordInput: page.getByLabel('Password', { exact: true }),
    confirmPasswordInput: page.getByLabel('Confirm Password', { exact: true }),
    loginButton: page.getByRole('button', { name: /login/i }),
    registerButton: page.getByRole('button', { name: /register/i }),
    signUpToggle: page.getByRole('button', { name: /sign up now/i }),
  };
}

export function projectsSelectors(page: Page) {
  return {
    projectsHeading: page.getByRole('heading', { name: /projects/i }),
    newProjectButton: page.getByRole('button', { name: /new project/i }),
    emptyProjectsMessage: page.getByText('No projects yet. Create your first project.'),
    // Project lookup in sidebar only, to avoid matching breadcrumb text
    projectByName: (name: string): Locator =>
      page.locator('aside').getByText(name),
  };
}

export function librariesSelectors(page: Page) {
  return {
    librariesHeading: page.getByRole('heading', { name: /libraries/i }),
    newLibraryButton: page.getByRole('button', { name: /new library/i }),
    emptyLibrariesMessage: page.getByText('No libraries in this project yet.'),
    // Library lookup in sidebar tree (where newly created libraries first appear)
    libraryByName: (name: string): Locator =>
      page.locator('aside').getByText(name),
  };
}


