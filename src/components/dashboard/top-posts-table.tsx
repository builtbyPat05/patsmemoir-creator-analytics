"use client";

import { useState } from "react";
import { ArrowUpRight, ChevronDown, ChevronUp } from "lucide-react";
import { formatPercentage, formatPostDate, platforms, type Post } from "@/lib/dashboard-data";

type TopPostsTableProps = {
  posts: Post[];
  formatNumber: (value: number) => string;
};

export function TopPostsTable({ posts, formatNumber }: TopPostsTableProps) {
  const [expanded, setExpanded] = useState(true);
  const [visibleCount, setVisibleCount] = useState(10);
  const visiblePosts = posts.slice(0, visibleCount);

  return (
    <>
      <div className="posts-list-controls">
        <button aria-expanded={expanded} className="posts-list-toggle" onClick={() => setExpanded((current) => !current)} type="button">
          {expanded ? <ChevronUp size={17} aria-hidden="true" /> : <ChevronDown size={17} aria-hidden="true" />}
          <span>Posts ranked by lifetime views</span>
        </button>
        <span className="posts-list-count">{posts.length} {posts.length === 1 ? "post" : "posts"}</span>
      </div>
      {expanded && <>
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
          {visiblePosts.map((post) => (
            <tr key={post.id}>
              <td>
                <div className="post-title-cell">
                  <span className={`post-thumb post-thumb-${post.accent}`} aria-hidden="true" />
                  <div>
                    <p className="post-title">
                      {post.url ? <a className="post-link" href={post.url} rel="noopener noreferrer" target="_blank" title={`View ${post.title} on ${platforms[post.platform].label}`}>
                        <span>{post.title}</span><ArrowUpRight size={14} aria-hidden="true" />
                      </a> : post.title}
                    </p>
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
              <td className="posts-empty-state" colSpan={5}>No published posts are available from this platform yet.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
    {posts.length > 10 && <div className="posts-list-actions">
      {visibleCount < posts.length && <button className="posts-list-action" onClick={() => setVisibleCount((count) => count + 10)} type="button">Show 10 more</button>}
      {visibleCount > 10 && <button className="posts-list-action" onClick={() => setVisibleCount(10)} type="button">Show fewer</button>}
    </div>}
      </>}
    </>
  );
}
