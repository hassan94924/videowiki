import React, { Component, PropTypes } from 'react'
import { Card, Image } from 'semantic-ui-react'
import { Link } from 'react-router-dom'

export default class ArticleCard extends Component {
  render () {
    const { url, image, title, className } = this.props

    const appClassName = className || 'c-app-card'

    return (
      <Link to={ url }>
        <Card className={ appClassName }>
          <Image src={ image } />
          <Card.Content>
            <Card.Header>{ title.split('_').join(' ') }</Card.Header>
          </Card.Content>
        </Card>
      </Link>
    )
  }
}

ArticleCard.propTypes = {
  url: PropTypes.string,
  image: PropTypes.string,
  title: PropTypes.string,
  className: PropTypes.string,
}
