# Course assignment – frontend notes

The backend now **restricts courses to those assigned to the logged-in user**. Unauthenticated or wrong-user requests get 401/403.

## Backend behavior

- **`GET /api/courses`** (list): Requires authentication. Returns only courses that have at least one **active** course-assignment targeting the current user by:
  - **Individual** – user is in the assignment’s `individual_user` list
  - **Department** – user’s `department` matches one of the assignment’s `departments`
  - **Company** – user’s `company` matches one of the assignment’s `companies`
  - **Location** – **AIA** users: `branch` matches one of the assignment’s `work_locations`; **Vega** users: `working_location` matches one of the assignment’s `work_locations`

- **`GET /api/courses/:id`** (one course): Requires authentication. Returns the course only if it is assigned to the current user (same rules as above). Otherwise **403 Forbidden**.

- If the user is **not logged in**: **401 Unauthorized** for both list and detail.

## What to change on the frontend

1. **Send JWT on every course request**  
   - List: `GET /api/courses`  
   - Detail: `GET /api/courses/:id` (or `:documentId` if you use it)  
   Attach the login token, e.g. `Authorization: Bearer <jwt>` (or whatever your `apiService` uses for authenticated requests).

2. **Handle 401**  
   - If the courses API returns **401**, treat the user as logged out: clear stored token/user and redirect to the login page.

3. **Handle 403 on course detail**  
   - If **GET /api/courses/:id** returns **403**, the user is not allowed to see that course (e.g. link from somewhere else or stale URL). Show a “You don’t have access to this course” message and/or redirect to the course list or home.

4. **Empty list is normal**  
   - **GET /api/courses** can return an empty list when the user has no assigned courses. Don’t treat that as an error; show an empty state like “No courses assigned to you.”

5. **No client-side “all courses”**  
   - There is no API that returns all courses regardless of assignment. The only list is the assigned one, so the frontend should not try to show “all courses” for a normal user.

## Summary

| Request              | Auth required | Response when not allowed   |
|----------------------|---------------|-----------------------------|
| GET /api/courses     | Yes           | 401 if no token             |
| GET /api/courses/:id  | Yes           | 403 if course not assigned  |

Always send the JWT for course list and course detail, and handle 401 (re-login) and 403 (no access to that course).
