---
title: Mock Interview Questions
date: 2024-12-06
---

0. Tell me Something About yourself

### Puzzle

1. 3 Ants and Triangle - https://www.geeksforgeeks.org/puzzle-21-3-ants-and-triangle/ - 2sol out of Every ant has two choices (pick either of two edges going through the corner on which ant is initially sitting).
2. 50 red marbles and 50 blue marbles - maximize prob of selection of red marble
3. https://www.geeksforgeeks.org/puzzle-31-minimum-cut-puzzle/
4. https://www.geeksforgeeks.org/puzzle-3-calculate-total-distance-travelled-by-bee/
5. https://www.geeksforgeeks.org/puzzle-2-find-ages-of-daughters/
6. https://www.geeksforgeeks.org/puzzle-18-torch-and-bridge/

### CCN & OS

1. name OSI layer models, what is router
2. difference between router and switch?
3. scheduling algorithms
4. process management, CPU scheduling FIFO,LRU etc
5. Preemptive, non preemptive their difference and advantages and disadvantages of both
6. What are the HTTP and the HTTPS protocol?
7. What is the UDP protocol?
8. What do you mean by the DHCP Protocol?
9. What is a subnet? How to do subnetting
10. What are Unicasting, Anycasting, Multicasting and Broadcasting?
11. What happens when you enter google.com in the web browser?
12. What is REST API
13. What is stateful vs stateless architecture
14. What is Port? Nos of DNS, HTTP
15. What is Reliable Data Transfer
16. What is Topology? Star? Bus? Ring? Mesh? Tree?
17.

### DBMS & SQL

1. different normalization forms and asked about serializable schedules
2. Can you implement MongoDB using Data Structure?
3. Types of database languages
4. What are ACID and BASE properties in databases
5. What is Indexing in DBMS
6. Joins in SQL
7. SQL queries (group by, aggregate functions, order by, left join, right join, etc)
8. asked me how SQL queries are executed
9. What is the difference between SQL and NoSQL databases and which should be used when?
10. How indexing improves database queries and what it is
11. What is the difference between primary key and unique constraints?
12. What is a Trigger?
13. What is the concept of sub-query in terms of SQL?
14. What is the use of the DROP command and what are the differences between DROP, TRUNCATE and DELETE commands?
15. What are the different levels of abstraction in the DBMS? Physical? Logical? View?
16. SQL - Write a SQL query to fetch unique values of MAJOR Subjects from Student table.
    1. ```SELECT DISTINCT MAJOR from STUDENT;
       or
       SELECT MAJOR FROM STUDENT GROUP BY(MAJOR);
       ```
17. SQL - Write a SQL query to print the FIRST_NAME and LAST_NAME from Student table into single column COMPLETE_NAME.
    `SELECT CONCAT(FIRST_NAME, ' ', LAST_NAME) AS COMPLETE_NAME FROM Student;`
18. SQL - Write an SQL query to fetch Students full names with GPA >= 8.5 and <= 9.5.
    `SELECT CONCAT(FIRST_NAME, ' ', LAST_NAME) AS FULL_NAME FROM Student WHERE GPA BETWEEN 8.5 and 9.5;`
19. SQL - Write a query to fetch top N records.
    1. `SELECT * FROM EmpPosition ORDER BY Salary DESC LIMIT N;`
20. SQL - Write a query to fetch all the records from the EmployeeInfo table ordered by EmpLname in descending order and Department in the ascending order.
    1. `SELECT * FROM EmployeeInfo ORDER BY EmpFname desc, Department asc;`
21. SQL - Write a query to find the third-highest salary from the EmpPosition table
    1. `SELECT TOP 1 salary FROM(SELECT TOP 3 salary FROM employee_table ORDER BY salary DESC) S emp ORDER BY salary ASC;`
22.

### Java & OOPS

1. OOPS, polymorphism, access modifiers and code reusability
2. difference between abstraction and encapsulation.
3. Difference between java overriding and overloading.
4. Is overriding static polymorphism?
5. different access modifiers in java?
6. whether a private class can be inherited, and if so, which access modifiers are allowed for the child class
7. How can we achieve abstraction?
8. What is interface and abstract classes, state the differences.
9. Can an interface be private? Or any of its methods?
10. Difference between static and final keywords? Can static methods be overridden?
11. if private methods can be inherited, he then asked what can be the access modifiers of overridden methods in child class.
12. What is Encapsulation
13. Primitive and wrapper data types Java
14. Can I add int a and Integer B.
15. Mutable and immutable strings in java and some more questions related to it.
16. what is a nullpointerexception error
17. When a code stops with an exit code of 1, what is the error?
18. Difference between aggregation and composition
19. Why java does not support multiple inheritances through classes?
20. How to implement Multiple inheritances in java

### Projects

1. how data flow works between frontend and backend
2. how we test apis
3. what is MVC architecture
4. which frontend framework I used and why
5. he asked me about their difference and which was better and why. React vs Svelte
6. what is state, why is it used, data binding in react, one way, two-way data binding, and a couple of more questions related to react
7. why I used mongodb, why is it good, difference between sql and mongo, which is better and why
8. How to connect mongo to the server, how is the connection established.
9. he asked me about web services, how database communicates with the server.
10. he asked about pagination indirectly I did not know the term.
11. I had socket-io mentioned on my resume so he asked me what is this, how does the communication take place, what happens on the server side
12. the internal working of my second project, the behaviour of my website and about APIs.
13. when to use which and concepts about different types of databases
14. how we can deploy these projects and use the concept of load balance after deploying
15. how I learn different programming languages
16. What is CAP theorem
17. Authentication vs Authorization
18. What is CORS, and how does it work?
19. Have you used Axios?
20. What is Mongoose used for
21. What is the scope in JavaScript?
22. What is a media query in CSS?
23. What is lazy loading?
24. What is hoisting in JavaScript?
25. Difference between Client-Server & P2P
26. What are WebSockets and how are they used?
27. What are Content Delivery Networks (CDNs) and how do they improve website performance?
28. What are promises, and how do they differ from callbacks?
29. What is the difference between a framework and a library in web development?

### HR

1. what are the responsibilities of a leader
2. if the team is lagging behind the expected schedule and you can only deliver 8 requirements out of 12 what will you do
3. why computer engineering
4. who’s my role model
5. why, do you want to go/not go for further studies
6. which company or product I like
7. what do I do for fun
8. why db, what are the values that I believe in
9. my strengths and weaknesses
10. about my role in these projects, how I collaborated with my teammates, the programming languages we used, the API’s we used, the frameworks used by us
11. if I had an offer from abroad versus an offer in India on my favorite tech project, which one would I choose
12. why I had done a course on Financial Markets(Minor in Mgmt)
13. what I wanted to accomplish in the next 5-10 years
14. Why Deutsche Bank? Describe Deutsche Bank in one word.
15. how would I react if a project I worked on had issues with the model, and everyone blamed me?
16. If the issue escalated to the manager, how would I handle it?
17. If you are put into a team which has a completely different tech stack what will you do?
18. If for this reason your team lacks behind because you were taking time to complete it how will you take responsibility for it?
19. If a member of your team now complains about it how will you react?
20. They inquired if I would reject an offer from another banking company for DB
21. What is the biggest challenge you faced till now?
22. how you would handle the situation if your team contains lazy people who are not contributing to the project.
23. Now your manager is upset with all of you. How will you handle it?
24. Why did you used MongoDB instead of SQL.(if you are using any technology in your project make sure why you know why you selected that tech instead of other)
25. Asked me about my technical interest.
26. 2 positions of responsibility on my resume
27. what I would do if there is an urgent deadline to fulfill tomorrow and one of my teammates calls in sick.
28. Asked me if I have participated in hackathons. How was my experience. How do I collaborate during the hackathon, what is my role during a hackathon
29. my most interesting project and inspiration
30. how I have averted a crisis
31. when have I showcased leadership
32. why would I join an investment bank over a tech company,
33. why DB over that company
34. what if another company offers me more salary than DB
35. what I do in my free time.
36. how I got into SPIT and what was the overall experience of 3 years of engineering
37. how do I keep myself updated with all the recent technologies and the usecases of the technologies used in projects.
38. Which would you prefer, teamwork or individual work and why?
39. One thing which I would be upset with in any company
