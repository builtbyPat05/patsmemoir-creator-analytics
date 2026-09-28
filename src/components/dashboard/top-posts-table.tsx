import { formatPercentage, formatPostDate, platforms, type Post } from "@/lib/dashboard-data";

type TopPostsTableProps = {
  posts: Post[];
  formatNumber: (value: number) => string;
};

export function TopPostsTable({ posts, formatNumber }: TopPostsTableProps) {
  return (
    <div className="table-wrap">
      <table className="posts-table">
        <thead>
          <tr>
            <th scope="col">Post</th>
            <th scope="col">Platform</th>
            <th scope="col">Published</th>
            <th scope="col">Views</th>
            <th scope="col">Engagement</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id}>
              <td>
                <div className="post-title-cell">
                  <span className={`post-thumb post-thumb-${post.accent}`} aria-hidden="true" />
                  <div>
                    <p className="post-title">{post.title}</p>
                    <p className="post-pillar">{post.pillar}</p>
                  </div>
                </div>
              </td>
              <td><span className="platform-label">{platforms[post.platform].label}</span></td>
              <td><span className="table-muted">{formatPostDate(post.publishedAt)}</span></td>
              <td><span className="table-value">{formatNumber(post.views)}</span></td>
              <td><span className="engagement-value">{formatPercentage(post.engagementRate)}</span></td>
            </tr>
          ))}
          {posts.length === 0 && (
            <tr>
              <td className="posts-empty-state" colSpan={5}>No posts are available for this period.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
