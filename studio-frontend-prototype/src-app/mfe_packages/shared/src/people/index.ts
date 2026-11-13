/** People and teams, shared by the organization's People (people-mfe) and a project's Team (team-mfe). */

export * from './types';
export * from './access';
export * from './orgPeople';
export * from './activity';
export { PeopleApiService, PEOPLE_PAGE } from './PeopleApiService';
export { openProjectTeam, TEAM_ROUTE, type TeamTarget } from './openTeam';
