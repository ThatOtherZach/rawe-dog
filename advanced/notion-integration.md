# Notion Integration (Optional Advanced Feature)

Some users like to save generated resumes directly into a Notion Job Applications database for tracking and historical learning.

This is an advanced, optional extension. It requires:

- A Notion integration token with access to your database
- The database to have specific properties (Job Title, Company, Status, Date Applied, Job Link, etc.)
- Custom scripting or using tools that can call the Notion API

If you want to implement this, the core idea is:
- After generating a resume, create a new page in your applications database
- Store the full markdown resume in the page content
- Use past applications as light context for future tailoring ("previous feedback suggested emphasizing stakeholder management more")

This feature is intentionally left as an advanced exercise because it adds complexity and requires storing application history.

Most people get 80-90% of the value from the core framework without this.
